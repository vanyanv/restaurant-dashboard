# Perf Audit

Base URL: http://localhost:3000

viewport | route | status | FCP ms | LCP ms | CLS | DOM nodes | long tasks | long task ms | scroll ms | search ms
--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:
mobile | /dashboard/menu/catalog | 200 | 144 |  | 0 | 902 | 0 | 0 | 78 | 109
mobile | /m | 200 | 752 |  | 0 | 228 | 0 | 0 | 69 | 
mobile | /m/menu | 200 | 880 |  | 0 | 217 | 0 | 0 | 68 | 109
mobile | /m/recipes | 200 | 724 |  | 0 | 216 | 0 | 0 | 78 | 117
mobile | /m/ingredients | 200 | 836 |  | 0 | 235 | 0 | 0 | 81 | 110
mobile | /m/orders | 200 | 900 |  | 0 | 85 | 0 | 0 | 68 | 
mobile | /m/invoices | 200 | 268 |  | 0 | 511 | 0 | 0 | 80 | 
mobile | /m/pnl | 200 | 680 |  | 0 | 116 | 0 | 0 | 83 | 
mobile | /m/analytics | 200 | 352 |  | 0 | 95 | 0 | 0 | 74 | 
mobile | /m/product-mix | 200 | 624 |  | 0 | 288 | 0 | 0 | 78 | 
mobile | /m/cogs | 200 | 124 |  | 0 | 81 | 0 | 0 | 77 | 
mobile | /m/more | 200 | 48 |  | 0 | 112 | 0 | 0 | 78 | 
