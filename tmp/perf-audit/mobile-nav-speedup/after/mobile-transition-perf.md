# Mobile Transition Perf

Base URL: http://localhost:3000

route | from | shell ms | ready ms | long tasks | long task ms | max long task ms | DOM nodes | CLS
--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---:
/m | /m/more | 51 | 56 | 0 | 0 | 0 | 228 | 0
/m/invoices | /m/more | 56 | 61 | 0 | 0 | 0 | 297 | 0
/m/chat | /m/more | 85 | 370 | 0 | 0 | 0 | 91 | 0
/m/pnl | /m/more | 38 | 43 | 0 | 0 | 0 | 120 | 0
/m/more | /m | 49 | 54 | 0 | 0 | 0 | 135 | 0
