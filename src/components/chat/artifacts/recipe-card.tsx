"use client"

import type { RecipeResult } from "@/lib/chat/tools/recipes"
import { CardShell, Num, fmtMoney } from "./card-shell"

interface Props {
  recipe: RecipeResult
  collapsedDefault?: boolean
}

export function RecipeCard({ recipe, collapsedDefault }: Props) {
  const total =
    recipe.foodCostOverride !== null
      ? recipe.foodCostOverride
      : recipe.computedTotalCost
  return (
    <CardShell
      dept="RECIPE"
      headline={
        <span className="chat-artifact__title-italic">{recipe.itemName}</span>
      }
      subline={
        <>
          <span>{recipe.category}</span>
          <span> · serves {recipe.servingSize}</span>
          {recipe.foodCostOverride !== null ? (
            <span> · cost overridden</span>
          ) : null}
        </>
      }
      defaultOpen={!collapsedDefault}
    >
      <div className="chat-artifact__table-wrap">
        <table className="chat-artifact__table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              <th className="num">Unit cost</th>
              <th className="num">Line cost</th>
            </tr>
          </thead>
          <tbody>
            {recipe.ingredients.map((ri, idx) => (
              <tr key={ri.ingredientId ?? `${idx}-${ri.name}`}>
                <td>
                  <div className="chat-artifact__line-name">{ri.name}</div>
                  {ri.source !== "canonical" ? (
                    <div className="chat-artifact__line-sub">
                      {ri.source === "component"
                        ? "component recipe"
                        : "free-text"}
                    </div>
                  ) : null}
                </td>
                <td className="num">
                  <Num>{ri.quantity.toLocaleString()}</Num>
                </td>
                <td>{ri.unit}</td>
                <td className="num">
                  <Num>
                    {ri.unitCost !== null ? fmtMoney(ri.unitCost) : "—"}
                  </Num>
                </td>
                <td className="num">
                  <Num>
                    {ri.lineCost !== null ? fmtMoney(ri.lineCost) : "—"}
                  </Num>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="chat-artifact__tfoot-label chat-artifact__tfoot-label--bold">
                {recipe.foodCostOverride !== null
                  ? "Food cost (override)"
                  : "Food cost (computed)"}
              </td>
              <td className="num">
                <Num>{total !== null ? fmtMoney(total) : "—"}</Num>
              </td>
            </tr>
          </tfoot>
        </table>
        {!recipe.fullyCosted && recipe.foodCostOverride === null ? (
          <div className="chat-artifact__hint">
            Some ingredient costs aren't known yet — total is partial.
          </div>
        ) : null}
      </div>
    </CardShell>
  )
}
