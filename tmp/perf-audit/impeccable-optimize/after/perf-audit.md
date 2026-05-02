# Perf Audit

Base URL: http://localhost:3001

viewport | route | status | FCP ms | LCP ms | CLS | DOM nodes | long tasks | long task ms | scroll ms | search ms
--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:
mobile | /dashboard/menu/catalog | 200 | 1024 |  | 0 | 1258 | 2 | 139 | 72 | 114
mobile | /dashboard/recipes | 200 | 1124 |  | 0 | 498 | 1 | 74 | 77 | 
mobile | /dashboard/ingredients | 200 | 1136 |  | 0 | 1474 | 2 | 138 | 89 | 
mobile | /dashboard/ingredients/prices | 200 | 776 |  | 0 | 844 | 2 | 127 | 129 | 224
mobile | /m | 200 | 1728 |  | 0 | 583 | 1 | 61 | 72 | 
mobile | /m/menu | 200 | 1272 |  | 0 | 577 | 1 | 59 | 86 | 125
mobile | /m/recipes | 200 | 1024 |  | 0 | 576 | 1 | 55 | 78 | 146
mobile | /m/ingredients | 200 | 1052 |  | 0 | 595 | 1 | 58 | 84 | 155
mobile | /m/orders | 200 | 1872 |  | 0 | 444 | 1 | 61 | 84 | 
mobile | /m/invoices | 200 | 740 |  | 0 | 873 | 1 | 68 | 72 | 
mobile | /m/pnl | 200 | 1276 |  | 0 | 475 | 1 | 56 | 71 | 
mobile | /m/analytics | 200 | 808 |  | 0 | 453 | 1 | 62 | 83 | 
mobile | /m/product-mix | 200 | 1092 |  | 0 | 648 | 1 | 65 | 77 | 
mobile | /m/cogs | 200 | 448 |  | 0 | 439 | 1 | 56 | 69 | 
mobile | /m/more | 200 | 468 |  | 0 | 470 | 1 | 59 | 70 | 
desktop | /dashboard/menu/catalog | 200 | 168 |  | 0 | 1381 | 2 | 148 | 72 | 111
desktop | /dashboard/recipes | 200 | 376 |  | 0 | 635 | 1 | 87 | 84 | 
desktop | /dashboard/ingredients | 200 | 204 |  | 0 | 1585 | 2 | 142 | 92 | 
desktop | /dashboard/ingredients/prices | 200 | 148 |  | 0 | 1038 | 2 | 128 | 140 | 221
desktop | /m | 200 | 532 |  | 0 | 583 | 1 | 60 | 74 | 
desktop | /m/menu | 200 | 928 |  | 0 | 577 | 1 | 64 | 86 | 147
desktop | /m/recipes | 200 | 748 |  | 0 | 576 | 1 | 57 | 83 | 135
desktop | /m/ingredients | 200 | 764 |  | 0 | 587 | 1 | 65 | 92 | 159
desktop | /m/orders | 200 | 1484 |  | 0 | 444 | 1 | 57 | 77 | 
desktop | /m/invoices | 200 | 408 |  | 0 | 873 | 1 | 58 | 84 | 
desktop | /m/pnl | 200 | 184 |  | 0 | 475 | 1 | 60 | 75 | 
desktop | /m/analytics | 200 | 448 |  | 0 | 453 | 1 | 62 | 82 | 
desktop | /m/product-mix | 200 | 692 |  | 0 | 648 | 1 | 58 | 83 | 
desktop | /m/cogs | 200 | 184 |  | 0 | 439 | 1 | 62 | 70 | 
desktop | /m/more | 200 | 140 |  | 0 | 470 | 1 | 67 | 73 | 
