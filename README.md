# PestLeadWire

pestleadwire.buusystems.com, a BUU Systems project. Shows how PestLeadWire connects
demand (businesses and buildings with public pest violations) to supply (licensed pest
control pros), plus live pest records for any zip code in New York City and Chicago.

Static site: `index.html`, `styles.css`, `app.js`. No build step and no backend. The
browser queries the city Socrata APIs directly (CORS open, no key):

| City | Source | Dataset |
|------|--------|---------|
| NYC | DOHMH restaurant inspections, codes 04K rats, 04L mice, 04M roaches, 04N flies | `43nn-pn8j` |
| NYC | HPD housing violations mentioning infestation / bed bugs | `wvxf-dwi5` |
| NYC | 311 `Rodent` complaints | `erm2-nwe9` |
| Chicago | CDPH food inspections citing item 38 (insects, rodents and animals) | `4ijn-s7e5` |
| Chicago | 311 `Rodent Baiting/Rat Complaint` | `v6vf-nfxy` |

Housing and 311 addresses are rounded to the block (`200 block of East 5 Street`).

## Run locally

    python3 -m http.server 8761      # then open http://localhost:8761/?zip=10003

## Deploy (not done yet)

`CNAME` is set for GitHub Pages. To go live: create `buusystems/pestleadwire`, push
`main`, enable Pages on `main` / root, and add DNS `CNAME pestleadwire -> buusystems.github.io`.
The join form is a `mailto:` link to ross@buusystems.com.
