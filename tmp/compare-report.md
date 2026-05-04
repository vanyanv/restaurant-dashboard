# Re-extraction comparison report — 2026-05-03T22:23:00.206Z
Compared 49 invoices.

## Summary
- ✗ Errors: 0
- ⚠ Total amount drift > $0.50: 0
- ⚠ Line count changed: 33
- ⚠ Still has pack-shape anomalies after re-extract: 15
- ⚠ Has math mismatches after re-extract: 0

## Sysco Los Angeles, Inc. #945638319 (2026-02-19)
- ID: `cmm18zxrw000n2du9k65qtwdp`
- old total $2549.12 → new total $2549.12 (drift $0.00)
- old lines 11 → new lines 11
- changed lines: 4

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 1405521 | LYON M SYRUP CHOCOLATE FREE FLOW | `4×1 GAL` | `2×41 GAL` | $329.44 | $329.44 |
| 5296108 | LYON M SYRUP STRAWBERRY RTU | `4×1 GAL` | `2×41 GAL` | $350.64 | $350.64 |
| 4685614 | SYS CLS GLOVE NITRILE FDSRV PF BLK | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | PACKER LETTUCE BSTN HYDROPONIC | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |
- ⚠ post-extract pack anomalies: 2
  - L5 "LYON M SYRUP CHOCOLATE FREE FLOW": unitSize=41 GAL exceeds plausible container size (≤10 typical)
  - L7 "LYON M SYRUP STRAWBERRY RTU": unitSize=41 GAL exceeds plausible container size (≤10 typical)

## Sysco Los Angeles, Inc. #945647380 (2026-02-21)
- ID: `cmm18zyer001e2du9wwj7gpmc`
- old total $1354.75 → new total $1354.75 (drift $0.00)
- old lines 8 → new lines 8
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Sys Cls Glove Nitrile Fdsrv Pf Blk | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Bstn Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |

## Individual FoodService #G44506-00 (2026-02-23)
- ID: `cmm18zy3n00102du94pb2r2bd`
- old total $749.70 → new total $749.70 (drift $0.00)
- old lines 13 → new lines 14
- changed lines: 4

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| G7234 | Soda Coke Mexican Glass | `24×0.5 L` | `24×500 ML` | $93.14 | $93.14 |
| G7244 | Soda Sprite Mexican Glass CRV Inc | `24×0.5 L` | `24×500 ML` | $43.01 | $43.01 |
| G7246 | Soda Orange Fanta Mexican Glass | `24×0.5 L` | `24×500 ML` | $43.01 | $43.01 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |
- ⚠ post-extract pack anomalies: 2
  - L11 "Ketchup Packets Foil": packSize=1000 for unit=CS is implausibly high — likely a fused PACK/SIZE split
  - L13 "Emboss Bath Tissue 2ply Recy Ind Wrp": packSize=96 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco Los Angeles, Inc. #945649371 (2026-02-23)
- ID: `cmm40uiw5000004juh1rz22ai`
- old total $2613.96 → new total $2613.96 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 5

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7370699 | GREENO CUP PET 20 OZ | `1000×1 CT` | `1×200 OZ` | $193.10 | $193.10 |
| 7380317 | CHRSNED BAG PLAS TSHIRT LOGO PTSB | `11×1000 CT` | `1×1000 CT` | $258.08 | $258.08 |
| 7190716 | GREENO LID FLAT W/HOLE 20OZ PE PET | `11×1000 CT` | `1×1000 CT` | $142.90 | $142.90 |
| 2717106 | PACKER LETTUCE BSTN HYDROPONIC | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Sysco Los Angeles, Inc. #945660521 (2026-02-26)
- ID: `cmm6tja5c01076iu928vqwd7o`
- old total $2635.20 → new total $2635.20 (drift $0.00)
- old lines 10 → new lines 11
- changed lines: 4

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 6040760 | Sysco Classic Salt Kosher Flake Coarse | `123×1 LB` | `1×23 LB` | $57.99 | $57.99 |
| 4685614 | Sysco Classic Glove Nitrile Food Service | `100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $134.45 | $134.45 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Individual FoodService #G49714-00 (2026-02-26)
- ID: `cmm6tj9t100zo6iu9b0gift9l`
- old total $1869.24 → new total $1869.24 (drift $0.00)
- old lines 18 → new lines 20
- changed lines: 6

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| PP5 | Paper Patty 5.5x5.5 Dry Wax | `1×1000 CT` | `24×1 CT` | $253.44 | $253.44 |
| 40X46ROLL | Can Liner 40x46 1.5 mil Black Roll | `40×45 GA` | `4×25 CT` | $35.28 | $35.28 |
| 965-REY | Foam Container Hinged White 9x6.5x2.5 | `9×6 CT` | `2×100 CT` | $148.75 | $148.75 |
| HT91-BAG | Foam Container 9x9 1-Comp Bagged | `9×1 CT` | `2×100 CT` | $61.90 | $61.90 |
| - | Pallet Charge | `(new line)` | `-×- -` | $0.00 | $6.50 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |
- ⚠ post-extract pack anomalies: 2
  - L11 "Paper Patty 5.5x5.5 Dry Wax": CT pack-shape 24×1 looks fused — produce/case-goods CT typically has packSize=1 with unitSize=count
  - L18 "Emboss Bath Tissue 2-ply Recycled Individual Wrap": packSize=96 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco Los Angeles, Inc. #945668952 (2026-02-28)
- ID: `cmmjjnxjm00inx5u9pwfavcw4`
- old total $1892.35 → new total $1892.35 (drift $0.00)
- old lines 8 → new lines 9
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | SYS CLS Glove Nitrile FDSRV PF BLK | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Individual FoodService #G53437-00 (2026-03-02)
- ID: `cmo6uptj5005vkeu9bw50ga46`
- old total $549.28 → new total $549.28 (drift $0.00)
- old lines 10 → new lines 10
- changed lines: 0
- ⚠ post-extract pack anomalies: 1
  - L9 "Mustard Pkts": packSize=200 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco Los Angeles, Inc. #945674659 (2026-03-02)
- ID: `cmmjjnz0300j8x5u9747hpl78`
- old total $1939.55 → new total $1939.55 (drift $0.00)
- old lines 8 → new lines 9
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | SYS CLS Glove Nitrile FDSRV PF BLK | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | CHGS FOR Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Sysco Los Angeles, Inc. #945679552 (2026-03-03)
- ID: `cmmjjnzaw00jhx5u9wq57rhx2`
- old total $387.82 → new total $387.82 (drift $0.00)
- old lines 4 → new lines 4
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 1234271 | CTECOCRFT PAPER WAX DELI | `10×6.75 IN` | `10×1000 CT` | $95.00 | $95.00 |
| 4919571 | ERTHPLS LID PLAS CLR DOME F/BURR | `650×1 CT` | `6×50 CT` | $94.43 | $94.43 |
| 7381771 | ERTHPLS BOWL PULP OVAL | `475×1 CT` | `4×75 CT` | $154.99 | $154.99 |

## Sysco #945685538 (2026-03-05)
- ID: `cmmjjnzw900jpx5u98616a0q8`
- old total $2643.91 → new total $2643.91 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Nitrile Gloves Foodservice Powder Free B | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $161.34 | $161.34 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Sysco Los Angeles, Inc. #945695053 (2026-03-07)
- ID: `cmmjjo0hi00k1x5u95zbrdf2l`
- old total $1896.75 → new total $1896.75 (drift $0.00)
- old lines 11 → new lines 11
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Glove Nitrile Food Service Powder Free B | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |

## Individual FoodService #G62143-00 (2026-03-09)
- ID: `cmmjjo0s700kcx5u9fmgqlivu`
- old total $856.84 → new total $856.84 (drift $0.00)
- old lines 12 → new lines 13
- changed lines: 6

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| G7234 | Soda Coke Mexican Glass | `24×500 ML` | `24×0.5 L` | $93.14 | $93.14 |
| G7244 | Soda Sprite Mexican Glass CRV Inc | `24×500 ML` | `24×0.5 L` | $43.01 | $43.01 |
| G7246 | Soda Orange Fanta Mexican Glass | `24×500 ML` | `24×0.5 L` | $43.01 | $43.01 |
| 12345 | Water Crystal Geyser Spring | `35×16.9 OZ` | `35×0.563 L` | $9.78 | $9.78 |
| 14960 | Tray Pulp 4-Cup Carrier 8-32oz | `4×75 CT` | `4×32 OZ` | $56.75 | $56.75 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |
- ⚠ post-extract pack anomalies: 1
  - L10 "Ketchup Packets Foil": packSize=1000 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco #945696984 (2026-03-09)
- ID: `cmo6updms005kkeu9jgzgboe3`
- old total $2659.36 → new total $2659.36 (drift $0.00)
- old lines 10 → new lines 11
- changed lines: 7

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 00500520 | Martins Bread Potato Roll SNDW 3.5I | `(new line)` | `9×8 CT` | $0.00 | $697.50 |
| 7370699 | Greeno Cup PET 20 OZ C&D PET | `1000×1 CT` | `10×100 CT` | $193.10 | $193.10 |
| 7380317 | CHRSNED Bag Plas TShirt Logo | `10×1000 CT` | `1×1000 CT` | $129.04 | $129.04 |
| 7190716 | Greeno Lid Flat w/Hole 20oz PE | `10×1000 CT` | `1×1000 CT` | $142.90 | $142.90 |
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |
| 3589484 | Martins Bread Potato Roll Sandwich 3.5 i | `9×8 CT` | `(dropped)` | $697.50 | $0.00 |

## Sysco #945707660 (2026-03-12)
- ID: `cmo6unpkl004pkeu94frmizbp`
- old total $2182.37 → new total $2182.37 (drift $0.00)
- old lines 8 → new lines 9
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Sysco #945717028 (2026-03-14)
- ID: `cmo6umhzp0040keu9granej7o`
- old total $2036.18 → new total $2036.18 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Sysco CLS Glove Nitrile FDSRV PF Black | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Sysco #945719143 (2026-03-16)
- ID: `cmo6um3y5003skeu9jd0d8jd0`
- old total $1904.86 → new total $1904.86 (drift $0.00)
- old lines 7 → new lines 8
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 2717106 | PACKER LETTUCE BSTN HYDROPONIC | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Individual FoodService #G70746-00 (2026-03-16)
- ID: `cmo6un4jp004ckeu9yr2e3mob`
- old total $715.94 → new total $715.94 (drift $0.00)
- old lines 10 → new lines 11
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 12345 | Water Crystal Geyser Spring | `35×16.9 OZ` | `35×0.56 L` | $9.78 | $9.78 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |
- ⚠ post-extract pack anomalies: 1
  - L7 "Mustard Packets 5.5 Gr PPI": packSize=200 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco Los Angeles, Inc. #945729735 (2026-03-19)
- ID: `cmn80urx0000004jxzgkxiook`
- old total $2677.45 → new total $2677.45 (drift $0.00)
- old lines 13 → new lines 14
- changed lines: 7

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685576 | Glove Nitrile Food Service Powder Free B | `10000×1 CT` | `10×100 CT` | $35.75 | $35.75 |
| 4685614 | Glove Nitrile Food Service Powder Free B | `10000×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 7370699 | Greeno Cup PET 20 OZ | `1000×1 CT` | `9×55 OZ` | $193.10 | $193.10 |
| 7380317 | Chrs Ned Bag Plastic T-Shirt Logo | `11×1000 CT` | `1×1000 CT` | $129.04 | $129.04 |
| 7190716 | Greeno Lid Flat w/Hole 20oz PE PET | `11×1000 CT` | `1×1000 CT` | $142.90 | $142.90 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Individual FoodService #G76238-00 (2026-03-19)
- ID: `cmo6ulpo6003ekeu9vhilco0n`
- old total $922.78 → new total $922.78 (drift $0.00)
- old lines 13 → new lines 14
- changed lines: 1

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |
- ⚠ post-extract pack anomalies: 1
  - L5 "Bag T-Shirt 12x7x22 White 17 Mic": packSize=540 for unit=CS is implausibly high — likely a fused PACK/SIZE split; CT pack-shape 540×1 looks fused — produce/case-goods CT typically has packSize=1 with unitSize=count

## Sysco Los Angeles, Inc. #945736383 (2026-03-21)
- ID: `cmn80us2m000u04jxdnij8en4`
- old total $2244.39 → new total $2244.39 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 5

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 00500520 | Martins Bread Potato Roll SNDW 3.5I | `(new line)` | `9×8 CT` | $0.00 | $581.25 |
| 5935689 | Sys CLS Spice Pepper BLK GRND | `5×1 LB` | `-×- -` | $68.95 | $68.95 |
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |
| 3589484 | Martins Bread Potato Roll Sndw 3.5I | `9×8 CT` | `(dropped)` | $581.25 | $0.00 |

## Sysco Los Angeles, Inc. #945741472 (2026-03-23)
- ID: `cmn80us37001404jxs7pvbfqy`
- old total $2116.40 → new total $2116.40 (drift $0.00)
- old lines 8 → new lines 9
- changed lines: 10

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7087727 | WHLFCLS ICE CREAM MIX SFTSR VAN 5% | `(new line)` | `6×64 OZ` | $0.00 | $149.04 |
| 3589484 | MARTINS BREAD POTATO ROLL SNDW 3.5I | `(new line)` | `9×8 CT` | $0.00 | $697.50 |
| 4518403 | SYS REL SHORTENING FRY LIQ CLR ZTF | `(new line)` | `1×35 LB` | $0.00 | $36.95 |
| 4685614 | SYS CLS GLOVE NITRILE FDSRV PF BLK | `(new line)` | `10×100 CT` | $0.00 | $37.99 |
| 2717106 | PACKER LETTUCE BSTN HYDROPONIC | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |
| 1011849 | WHLFCLS Ice Cream Mix SFTSR VAN 5% | `6×64 OZ` | `(dropped)` | $149.04 | $0.00 |
| 00500520 | Martins Bread Potato Roll SNDW 3.5I | `9×8 CT` | `(dropped)` | $697.50 | $0.00 |
| 5020553 | SYS Rel Shortening Fry LIQ CLR ZTF | `1×35 LB` | `(dropped)` | $36.95 | $0.00 |
| 304363443 | SYS CLS Glove Nitrile FDSRV PF BLK | `10×100 CT` | `(dropped)` | $37.99 | $0.00 |

## Sysco Los Angeles, Inc. #945752339 (2026-03-26)
- ID: `cmnc5tbop000004johq0sdjyj`
- old total $3045.88 → new total $3045.88 (drift $0.00)
- old lines 12 → new lines 13
- changed lines: 5

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7370699 | Greeno Cup PET 20 Oz C&D PET | `1000×1 CT` | `1×20 OZ` | $193.10 | $193.10 |
| 7380317 | Chrsned Bag Plas Tshirt Logo Ptsbchrisne | `11000×1 CT` | `1×1000 CT` | $258.08 | $258.08 |
| 7190716 | Greeno Lid Flat w/Hole 20oz PE PET | `11×1000 CT` | `1×1000 CT` | $214.35 | $214.35 |
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Individual FoodService #G84442-00 (2026-03-26)
- ID: `cmn80us4e001f04jx1xi974hb`
- old total $2031.02 → new total $2031.02 (drift $0.00)
- old lines 24 → new lines 25
- changed lines: 7

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 40X46ROLL | Can Liner 40x46 1.5 mil Black Roll | `40×45 GA` | `4×25 GA` | $35.28 | $35.28 |
| PP5 | Paper Patty 5.5x5.5 Dry Wax | `1×1000 -` | `1×1000 CT` | $253.44 | $253.44 |
| G1025 | Ketchup Packets Foil 1000/9GR | `1000×9 GR` | `1×1000 CT` | $59.18 | $59.18 |
| 32096 | Paper Roll Thermal 3-1/8x220' BPA/BPS Fr | `50×1 RL` | `50×1 ROL` | $62.43 | $62.43 |
| 30394 | Embossed Bath Tissue 2-ply Recycled Indi | `96×500 -` | `96×500 CT` | $62.14 | $62.14 |
| G108 | Mustard Packets 5.5GRAM | `500×5.5 GR` | `500×5.5 GRAM` | $16.77 | $16.77 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |
- ⚠ post-extract pack anomalies: 2
  - L22 "Embossed Bath Tissue 2-ply Recycled Individually Wrapped": packSize=96 for unit=CS is implausibly high — likely a fused PACK/SIZE split
  - L24 "Mustard Packets 5.5GRAM": packSize=500 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco #945761642 (2026-03-28)
- ID: `cmo6ukzlg0032keu9jw10z5te`
- old total $2979.74 → new total $2979.74 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Sys CLS Glove Nitrile FDSRV PF BLK | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $8.95 |

## Sysco #945763808 (2026-03-30)
- ID: `cmo6ujtlg002bkeu9kgoudeyw`
- old total $2095.38 → new total $2095.38 (drift $0.00)
- old lines 10 → new lines 11
- changed lines: 4

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4000899 | Sugar Packet | `2000×0.1 OZ` | `20×1 OZ` | $21.00 | $21.00 |
| 7380317 | Bag Plastic T-Shirt Logo PTSB Chris N Ed | `11000×1 CT` | `1×1000 CT` | $258.08 | $258.08 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Individual FoodService #G88326-00 (2026-03-30)
- ID: `cmo6ukhtf002mkeu9bocbkrrx`
- old total $1363.35 → new total $1363.35 (drift $0.00)
- old lines 15 → new lines 16
- changed lines: 4

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| G216 | Ketchup Vol-Pack Heinz | `3×- GAL` | `3×1 GAL` | $42.82 | $42.82 |
| 40X46ROLL | Can Liner 40x46 1.5 mil Black Roll | `4×25 GA` | `4×25 CT` | $35.28 | $35.28 |
| IFS-PPF-B | Cutlery Fork Full Size Extra Heavy Black | `1000×1 CT` | `10×100 CT` | $19.98 | $19.98 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $5.95 |

## Sysco #945777245 (2026-04-02)
- ID: `cmo6uizpb0022keu9uhoyk0gs`
- old total $1444.14 → new total $1444.14 (drift $0.00)
- old lines 8 → new lines 9
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Sysco Classic Nitrile Foodservice Gloves | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Sysco #945775672 (2026-04-02)
- ID: `cmo6uio1k001ykeu9j22g6nht`
- old total $510.90 → new total $510.90 (drift $0.00)
- old lines 3 → new lines 3
- changed lines: 1

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 2717106 | Packer Lettuce Bstn Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |

## Sysco #945786246 (2026-04-04)
- ID: `cmo6ui2r3001kkeu92s1rgiga`
- old total $1713.83 → new total $1713.83 (drift $0.00)
- old lines 8 → new lines 9
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Individual FoodService #G95788-00 (2026-04-06)
- ID: `cmo6uhq05000ykeu9hus14h53`
- old total $1543.56 → new total $1543.56 (drift $0.00)
- old lines 21 → new lines 23
- changed lines: 9

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 14960 | Tray Pulp 4-Cup Carrier 8-32OZ | `4×75 CT` | `4×32 OZ` | $56.75 | $56.75 |
| - | Napkin Dispenser 2-Ply 8.5X6.5 White | `(new line)` | `24×250 CT` | $0.00 | $39.87 |
| - | Towel Multifold Kraft 1-Ply | `(new line)` | `16×250 CT` | $0.00 | $24.51 |
| - | Service Charge (Pallet Charge) | `(new line)` | `-×- -` | $0.00 | $6.50 |
| 12345 | Water Crystal Geyser Spring | `35×16.9 OZ` | `35×16.9 FL OZ` | $9.78 | $9.78 |
| G106 | Mustard Packets 5.5GR PPI | `200×5.5 GR` | `200×5.5 GRAM` | $11.68 | $11.68 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $7.75 |
| 18418 | Napkin Dispenser 2-Ply 8.5X6.5 White | `24×250 CT` | `(dropped)` | $39.87 | $0.00 |
| 18369 | Towel Multifold Kraft 1-Ply | `16×250 CT` | `(dropped)` | $24.51 | $0.00 |
- ⚠ post-extract pack anomalies: 2
  - L20 "Ketchup Packets Foil": packSize=1000 for unit=CS is implausibly high — likely a fused PACK/SIZE split
  - L21 "Mustard Packets 5.5GR PPI": packSize=200 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco #945788718 (2026-04-06)
- ID: `cmo6ugsb0000jkeu9zll49j8p`
- old total $3060.11 → new total $3060.11 (drift $0.00)
- old lines 12 → new lines 13
- changed lines: 7

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4983920 | Sys CLS Mayonnaise Banquet Extra Heavy D | `41×1 GAL` | `4×1 GAL` | $53.95 | $53.95 |
| 6004857 | Hellman Mayonnaise Extra Heavy | `41×1 GAL` | `4×1 GAL` | $971.55 | $971.55 |
| 4685614 | Sys CLS Glove Nitrile FDSRV PF Black | `100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 7370699 | Greeno Cup PET 20 oz | `1000×1 CT` | `1×1000 CT` | $96.55 | $96.55 |
| 7190716 | Greeno Lid Flat with Hole 20oz PE PET | `11000×1 EA` | `1×1000 CT` | $71.45 | $71.45 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Sysco #945798750 (2026-04-09)
- ID: `cmo6ufvfk0000keu9xx539jk6`
- old total $3154.42 → new total $3154.42 (drift $0.00)
- old lines 11 → new lines 12
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Nitrile Gloves Foodservice Powder Free B | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Sysco Los Angeles, Inc. #945807489 (2026-04-11)
- ID: `cmo509640001jlfu9eo42k4ux`
- old total $1654.83 → new total $1654.83 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 4

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7172848 | Sys Cls Salt Granulated Iodized | `9×4 LB` | `1×94 LB` | $28.95 | $28.95 |
| 6854509 | Sys Cls Paper Patty Square 5.5 | `81000×1 CT` | `8×1000 CT` | $85.99 | $85.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $107.56 | $107.56 |
| - | Fuel Surcharge | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Sysco Los Angeles, Inc. #945809694 (2026-04-13)
- ID: `cmo5094sf0018lfu98fmygnux`
- old total $1897.47 → new total $1897.47 (drift $0.00)
- old lines 7 → new lines 8
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 2717106 | Packer Lettuce BSTN Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Individual FoodService #H09376-00 (2026-04-16)
- ID: `cmo5094hc000nlfu9laa6gw8b`
- old total $1157.25 → new total $1157.25 (drift $0.00)
- old lines 20 → new lines 21
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| G106 | Mustard Packets 5.5GR PPI | `200×5.5 GR` | `200×5.5 GRAM` | $11.68 | $11.68 |
| - | Fuel Charge | `(new line)` | `-×- -` | $0.00 | $7.75 |
- ⚠ post-extract pack anomalies: 1
  - L13 "Mustard Packets 5.5GR PPI": packSize=200 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco Los Angeles, Inc. #945819855 (2026-04-16)
- ID: `cmo50946m0009lfu9uwispe1v`
- old total $3075.46 → new total $3075.46 (drift $0.00)
- old lines 13 → new lines 14
- changed lines: 6

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Glove Nitrile Food Service Powder-Free B | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 7370699 | Greeno Cup PET 20oz Clear and Natural | `1000×1 CT` | `10×200 OZ` | $193.10 | $193.10 |
| 7380317 | Chris N Eddy Plastic T-Shirt Bag Logo | `11×1000 CT` | `1×1000 CT` | $258.08 | $258.08 |
| 7190716 | Greeno Lid Flat with Hole 20oz PET | `11×1000 CT` | `1×1000 CT` | $142.90 | $142.90 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $134.45 | $134.45 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $10.00 |

## Individual FoodService #H10889-00 (2026-04-17)
- ID: `cmo5093vc0002lfu9sitaow8m`
- old total $363.67 → new total $363.67 (drift $0.00)
- old lines 7 → new lines 7
- changed lines: 1

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 40X46ROLL | CAN LINER 40X46 1.5 MIL BLK ROLL | `4×25 RL` | `4×25 GA` | $35.28 | $35.28 |
- ⚠ post-extract pack anomalies: 1
  - L4 "KETCHUP PACKETS FOIL": packSize=1000 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco #945828794 (2026-04-18)
- ID: `cmo77450h000004kvmhf45sen`
- old total $1985.26 → new total $1985.26 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 7

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7087727 | WHLFCLS ice cream mix soft serve vanilla | `(new line)` | `6×64 OZ` | $0.00 | $229.38 |
| 7485170 | WHLFIMP butter solid USDA AA unsalted | `(new line)` | `30×1 LB` | $0.00 | $98.95 |
| 4685614 | Sys CLS glove nitrile food service powde | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer lettuce Boston hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $10.00 |
| 1011849 | Whole Ice Cream Mix Soft Serve Vanilla 5 | `6×64 OZ` | `(dropped)` | $229.38 | $0.00 |
| 102706 | Butter Solid USDA AA Unsalted | `30×1 LB` | `(dropped)` | $98.95 | $0.00 |

## Sysco #945828794 (2026-04-18)
- ID: `cmo7ju8x7000d04l22whv9d8t`
- old total $1985.26 → new total $1985.26 (drift $0.00)
- old lines 9 → new lines 10
- changed lines: 9

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 1011849 | Whole Milk Ice Cream Mix Soft Serve Vani | `(new line)` | `6×64 OZ` | $0.00 | $229.38 |
| 102706 | Butter Solid USDA AA Unsalted | `(new line)` | `30×1 LB` | $0.00 | $98.95 |
| 5020553 | Sysco Release Shortening Fry Liquid Clea | `(new line)` | `1×35 LB` | $0.00 | $77.70 |
| 4685614 | Sysco Classic Glove Nitrile Food Service | `100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |
| - | CHGS FOR FUEL SURCHARGE | `(new line)` | `-×- -` | $0.00 | $10.00 |
| 7087727 | Ice Cream Mix Soft Serve Vanilla 5% | `6×64 OZ` | `(dropped)` | $229.38 | $0.00 |
| 7485170 | Butter Solid USDA AA Unsalted | `30×1 LB` | `(dropped)` | $98.95 | $0.00 |
| 4518403 | Shortening Fry Liquid Clear Zero Trans F | `1×35 LB` | `(dropped)` | $77.70 | $0.00 |

## Individual FoodService #H12702-00 (2026-04-20)
- ID: `cmo7ju8zb000n04l284rvw65c`
- old total $704.08 → new total $704.08 (drift $0.00)
- old lines 13 → new lines 13
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| G7244 | Soda Sprite Mexican Glass CRV Inc | `24×0.5 L` | `24×500 ML` | $43.01 | $43.01 |
| G106 | Mustard Packets 5.5 Gr | `200×5.5 GR` | `200×5.5 GRAM` | $11.68 | $11.68 |
- ⚠ post-extract pack anomalies: 2
  - L7 "Emboss Bath Tissue 2Ply Recy Ind Wrapped": packSize=96 for unit=CS is implausibly high — likely a fused PACK/SIZE split
  - L10 "Mustard Packets 5.5 Gr": packSize=200 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Individual FoodService #H12702-00 (2026-04-20)
- ID: `cmo7ju8r0000004l27v47mhne`
- old total $704.08 → new total $704.08 (drift $0.00)
- old lines 13 → new lines 13
- changed lines: 0
- ⚠ post-extract pack anomalies: 2
  - L7 "Emboss Bath Tissue 2ply Recy Ind Wrp": packSize=96 for unit=CS is implausibly high — likely a fused PACK/SIZE split
  - L10 "Mustard Pkts 5.5gr": packSize=200 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco Los Angeles, Inc. #945831303 (2026-04-20)
- ID: `cmoa1wl6t000004l29buyl779`
- old total $6422.52 → new total $6422.52 (drift $0.00)
- old lines 11 → new lines 11
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 4685614 | Sys CLS Glove Nitrile FDSRV PF Black | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 1008200 | Propack Lettuce Boston / Butter Fresh | `124×1 CT` | `1×24 CT` | $95.55 | $95.55 |

## Individual FoodService #H18097-00 (2026-04-23)
- ID: `cmobu5xs6000004jly2qyr4kv`
- old total $1329.92 → new total $1329.92 (drift $0.00)
- old lines 16 → new lines 16
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 965-REY | Cont Foam Hngd Wht | `2×100 CT` | `2×100 CT` | $192.72 | $0.00 |
| 40X46ROLL | Can Liner 40x46 1.5 Mil Blk Roll | `40×45 GA` | `4×25 GA` | $35.28 | $35.28 |
- ⚠ post-extract pack anomalies: 1
  - L8 "Ketchup Packets Foil": packSize=1000 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Vitco Foodservice #230159-00 (2026-04-23)
- ID: `cmobu5xvm000k04jlb1reoxtg`
- old total $2692.80 → new total $2692.80 (drift $0.00)
- old lines 3 → new lines 3
- changed lines: 0
- ⚠ post-extract pack anomalies: 1
  - L1 "CHRIS & EDDY'S HOUSE SCE": packSize=180 for unit=CS is implausibly high — likely a fused PACK/SIZE split

## Sysco #945841884 (2026-04-23)
- ID: `cmocwqyk4000004k6jrgo81pr`
- old total $2214.11 → new total $2214.11 (drift $0.00)
- old lines 11 → new lines 11
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 6040760 | Salt Kosher Flake Coarse | `12×3 LB` | `1×23 LB` | $57.99 | $57.99 |
| 4685614 | Glove Nitrile Foodservice Powder Free Bl | `100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $80.67 | $80.67 |

## Sysco #945850683 (2026-04-25)
- ID: `cmoh7iprz000004jmd0biuzt9`
- old total $835.54 → new total $835.54 (drift $0.00)
- old lines 7 → new lines 7
- changed lines: 2

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 304363443 | SYS CLS Glove Nitrile Food Service PF Bl | `10100×1 CT` | `10×100 CT` | $37.99 | $37.99 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |

## Sysco #945853003 (2026-04-27)
- ID: `cmoiasrgo000004kwu9z0uvv9`
- old total $1084.49 → new total $1084.49 (drift $0.00)
- old lines 8 → new lines 8
- changed lines: 3

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7370699 | Greeno PET Cup 20 oz | `1000×1 CT` | `1×1000 CT` | $96.55 | $96.55 |
| 7190716 | Greeno Lid Flat with Hole 20 oz | `11×1000 CT` | `1×1000 CT` | $142.90 | $142.90 |
| 2717106 | Packer Lettuce Boston Hydroponic | `112×1 CT` | `1×12 CT` | $53.78 | $53.78 |

## Sysco #945863397 (2026-04-30)
- ID: `cmonna7tf000204js8vt0bj0l`
- old total $926.48 → new total $926.48 (drift $0.00)
- old lines 7 → new lines 7
- changed lines: 5

| SKU | Product | Old | New | Old ext | New ext |
|---|---|---|---|---|---|
| 7087727 | WHLFLCS Ice Cream Mix Sftsr Van 5% | `(new line)` | `6×64 OZ` | $0.00 | $229.62 |
| 4685614 | Sys Cls Glove Nitrile Fdsrv Pf Blk | `(new line)` | `10×100 CT` | $0.00 | $37.99 |
| 7370699 | Greeno Cup Pet 20 Oz C&D Pet | `1000×1 CT` | `9×43 OZ` | $193.10 | $193.10 |
| 1011849 | WHLFCLS Ice Cream Mix Soft Serve Van 5% | `6×64 OZ` | `(dropped)` | $229.62 | $0.00 |
| 304363443 | SYS CLS Glove Nitrile Food Service Powde | `100×100 CT` | `(dropped)` | $37.99 | $0.00 |
