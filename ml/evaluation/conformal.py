"""MAPIE conformal wrapper around an XGBoost regressor.

Produces coverage-guaranteed 80% and 95% predictive intervals using
split conformal prediction (cv="prefit"). The wrapper retains the underlying
fitted estimator for point prediction parity with the pre-conformal pipeline.
"""

from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from mapie.regression import MapieRegressor
from xgboost import XGBRegressor


@dataclass
class ConformalWrapper:
    point_model: XGBRegressor
    mapie80: MapieRegressor
    mapie95: MapieRegressor

    def predict_intervals(
        self, X: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Return (point, lower80, upper80, lower95, upper95)."""
        point = self.point_model.predict(X)
        _, intervals80 = self.mapie80.predict(X, alpha=0.2)
        _, intervals95 = self.mapie95.predict(X, alpha=0.05)
        lower80 = intervals80[:, 0, 0]
        upper80 = intervals80[:, 1, 0]
        lower95 = intervals95[:, 0, 0]
        upper95 = intervals95[:, 1, 0]
        return point, lower80, upper80, lower95, upper95


def wrap_xgboost_conformal(
    base: XGBRegressor,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_calib: np.ndarray,
    y_calib: np.ndarray,
) -> ConformalWrapper:
    """Fit `base` on train, fit two MAPIE wrappers (80% and 95%) on calib.

    The calibration set MUST be disjoint from the training set to preserve
    the conformal coverage guarantee. Callers are responsible for the split.
    """
    base.fit(X_train, y_train)

    mapie80 = MapieRegressor(estimator=base, method="base", cv="prefit")
    mapie80.fit(X_calib, y_calib)
    mapie95 = MapieRegressor(estimator=base, method="base", cv="prefit")
    mapie95.fit(X_calib, y_calib)

    return ConformalWrapper(point_model=base, mapie80=mapie80, mapie95=mapie95)
