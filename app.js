"use strict";

// Live pest records by zip code, read in the browser from city Socrata APIs (CORS open, no key).

const PESTS = {
  rats:    { label: "Rats",         color: "#ff5a3c" },
  mice:    { label: "Mice",         color: "#ffa23c" },
  roaches: { label: "Roaches",      color: "#c98bff" },
  flies:   { label: "Flies",        color: "#4fb3ff" },
  bedbugs: { label: "Bed bugs",     color: "#ff7ab8" },
  rodents: { label: "Rodents",      color: "#ffcf3c" },
  entry:   { label: "Pest entry",   color: "#9aa0a6" },
};

const NYC_RESTAURANT_CODES = { "04K": "rats", "04L": "mice", "04M": "roaches", "04N": "flies" };

function pestFromText(text) {
  const t = (text || "").toUpperCase();
  if (/BED ?BUG/.test(t)) return "bedbugs";
  if (/\bMICE\b|\bMOUSE\b/.test(t)) return "mice";
  if (/\bRATS?\b/.test(t)) return "rats";
  if (/ROACH/.test(t)) return "roaches";
  if (/\bFLIES\b|\bFLY\b|GNAT/.test(t)) return "flies";
  if (/RODENT|DROPPING|GNAW/.test(t)) return "rodents";
  return "entry";
}

// "216 EAST 5 STREET" -> "200 block of East 5 Street"
function toBlock(address) {
  const m = String(address || "").trim().match(/^(\d+)[\dA-Z-]*\s+(.*)$/i);
  if (!m) return titleCase(address || "Address withheld");
  const n = parseInt(m[1], 10);
  const h = Math.floor(n / 100) * 100;
  return `${h ? h : "1-99"} block of ${titleCase(m[2])}`;
}

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 864e5);
  return d.toISOString().slice(0, 10) + "T00:00:00";
}

async function soql(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set("$" + k, v);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url.host} answered ${res.status}`);
  return res.json();
}

const NYC = "https://data.cityofnewyork.us/resource/";
const CHI = "https://data.cityofchicago.org/resource/";

const CITIES = {
  nyc: {
    name: "New York City",
    sources: [
      {
        id: "food",
        label: "Restaurants",
        stat: "restaurant inspections citing pests",
        async load(zip, since) {
          const codes = Object.keys(NYC_RESTAURANT_CODES).map((c) => `'${c}'`).join(",");
          const rows = await soql(NYC + "43nn-pn8j.json", {
            select: "camis,dba,building,street,inspection_date,violation_code,inspection_type",
            where: `zipcode='${zip}' AND violation_code in(${codes}) AND inspection_date>'${since}'`,
            order: "inspection_date DESC",
            limit: 5000,
          });
          // One row per violation; fold into one record per visit.
          const visits = new Map();
          for (const r of rows) {
            const key = r.camis + "|" + r.inspection_date;
            let v = visits.get(key);
            if (!v) {
              v = {
                date: r.inspection_date,
                title: titleCase(r.dba),
                where: titleCase(`${r.building || ""} ${r.street || ""}`),
                pests: new Set(),
                kind: "Health inspection",
                detail: r.inspection_type ? titleCase(r.inspection_type.split("/")[0]) : "",
                url: `${NYC}43nn-pn8j.json?camis=${encodeURIComponent(r.camis)}&inspection_date=${encodeURIComponent(r.inspection_date)}`,
                lead: "business",
              };
              visits.set(key, v);
            }
            v.pests.add(NYC_RESTAURANT_CODES[r.violation_code]);
          }
          return [...visits.values()];
        },
      },
      {
        id: "housing",
        label: "Housing",
        stat: "housing infestation orders",
        async load(zip, since) {
          const rows = await soql(NYC + "wvxf-dwi5.json", {
            select: "violationid,buildingid,housenumber,streetname,inspectiondate,novdescription,class,violationstatus",
            where: `zip='${zip}' AND inspectiondate>'${since}' AND (upper(novdescription) like '%INFESTATION%' OR upper(novdescription) like '%BEDBUG%' OR upper(novdescription) like '%BED BUG%')`,
            order: "inspectiondate DESC",
            limit: 5000,
          });
          // Several orders per building per day are common; fold them.
          const groups = new Map();
          for (const r of rows) {
            const key = r.buildingid + "|" + r.inspectiondate;
            let g = groups.get(key);
            if (!g) {
              g = {
                date: r.inspectiondate,
                title: toBlock(`${r.housenumber} ${r.streetname}`),
                where: "Multifamily building",
                pests: new Set(),
                kind: `HPD order${r.class ? ", Class " + r.class : ""}`,
                detail: "",
                count: 0,
                open: 0,
                url: `${NYC}wvxf-dwi5.json?buildingid=${encodeURIComponent(r.buildingid)}&inspectiondate=${encodeURIComponent(r.inspectiondate)}`,
                lead: "landlord",
              };
              groups.set(key, g);
            }
            g.pests.add(pestFromText(r.novdescription));
            g.count++;
            if (r.violationstatus === "Open") g.open++;
          }
          for (const g of groups.values()) {
            g.detail = `${g.count} order${g.count > 1 ? "s" : ""}` + (g.open ? `, ${g.open} still open` : "");
          }
          return [...groups.values()];
        },
      },
      {
        id: "311",
        label: "311 rodents",
        stat: "rodent complaints to 311",
        async load(zip, since) {
          const rows = await soql(NYC + "erm2-nwe9.json", {
            select: "unique_key,created_date,descriptor,incident_address,status",
            where: `incident_zip='${zip}' AND complaint_type='Rodent' AND created_date>'${since}'`,
            order: "created_date DESC",
            limit: 5000,
          });
          return rows.map((r) => ({
            date: r.created_date,
            title: toBlock(r.incident_address),
            where: "",
            pests: new Set([pestFromText(r.descriptor).replace(/^entry$/, "rodents")]),
            kind: "311 complaint",
            detail: r.descriptor || "",
            url: `${NYC}erm2-nwe9.json?unique_key=${encodeURIComponent(r.unique_key)}`,
            lead: "block",
          }));
        },
      },
    ],
  },
  chicago: {
    name: "Chicago",
    sources: [
      {
        id: "food",
        label: "Restaurants",
        stat: "food inspections citing pests",
        async load(zip, since) {
          const rows = await soql(CHI + "4ijn-s7e5.json", {
            select: "inspection_id,dba_name,address,inspection_date,results,inspection_type,violations",
            where: `zip='${zip}' AND inspection_date>'${since}' AND violations like '%INSECTS, RODENTS%'`,
            order: "inspection_date DESC",
            limit: 500,
          });
          return rows.map((r) => {
            const item = (r.violations || "").split(" | ").find((v) => v.includes("INSECTS, RODENTS")) || "";
            const comment = item.split("Comments:")[1] || "";
            const C = comment.toUpperCase();
            const pests = new Set();
            if (/\bMICE\b|\bMOUSE\b/.test(C)) pests.add("mice");
            if (/\bRATS?\b/.test(C)) pests.add("rats");
            if (/ROACH/.test(C)) pests.add("roaches");
            if (/\bFLIES\b|\bFLY\b|GNAT/.test(C)) pests.add("flies");
            if (/RODENT/.test(C)) pests.add("rodents");
            if (/DROPPING/i.test(comment) && !pests.has("mice") && !pests.has("rats")) pests.add("rodents");
            if (pests.size > 1) pests.delete("rodents");
            if (!pests.size) pests.add("entry");
            return {
              date: r.inspection_date,
              title: titleCase(r.dba_name),
              where: titleCase(r.address),
              pests,
              kind: `CDPH inspection: ${r.results}`,
              detail: comment.trim().slice(0, 180) + (comment.trim().length > 180 ? "…" : ""),
              url: `https://data.cityofchicago.org/resource/4ijn-s7e5.json?inspection_id=${encodeURIComponent(r.inspection_id)}`,
              lead: "business",
            };
          });
        },
      },
      {
        id: "311",
        label: "311 rodents",
        stat: "rat complaints to 311",
        async load(zip, since) {
          const rows = await soql(CHI + "v6vf-nfxy.json", {
            select: "sr_number,created_date,street_address,status,sr_type",
            where: `zip_code='${zip}' AND sr_type like 'Rodent%' AND created_date>'${since}' AND duplicate=false`,
            order: "created_date DESC",
            limit: 5000,
          });
          return rows.map((r) => ({
            date: r.created_date,
            title: toBlock(r.street_address),
            where: "",
            pests: new Set(["rats"]),
            kind: "311 request",
            detail: `${r.sr_type}, ${String(r.status || "").toLowerCase()}`,
            url: `${CHI}v6vf-nfxy.json?sr_number=${encodeURIComponent(r.sr_number)}`,
            lead: "block",
          }));
        },
      },
    ],
  },
};

function cityFor(zip) {
  const p3 = zip.slice(0, 3);
  if (["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "116"].includes(p3)) return "nyc";
  if (p3 === "606" || zip === "60707" || zip === "60827") return "chicago";
  return null;
}

// ---------------------------------------------------------------- UI

const $ = (s) => document.querySelector(s);
const state = { zip: "", days: 90, city: null, results: [], tab: "all", shown: 12, req: 0 };

function fmtDate(iso) {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysAgo(iso) {
  const d = Math.round((Date.now() - new Date(iso.slice(0, 10) + "T12:00:00")) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== "") n.append(k.nodeType ? k : String(k));
  return n;
}

function pestTag(p) {
  const meta = PESTS[p] || PESTS.entry;
  return el("span", { class: "pest", style: `--c:${meta.color}` }, meta.label);
}

async function load(zip, days) {
  const req = ++state.req;
  state.zip = zip;
  state.days = days;
  state.city = cityFor(zip);
  state.tab = "all";
  state.shown = 12;
  history.replaceState(null, "", `?zip=${zip}${location.hash}`);
  $("#zip-title").textContent = `Zip code ${zip}`;
  document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("is-on", +b.dataset.days === days));

  const status = $("#zip-status");
  if (!state.city) {
    $("#zip-sub").textContent = "Outside our live coverage.";
    status.className = "status";
    status.textContent = "We read live records for New York City and Chicago today. More cities are on the way: join below and we'll start with your zip.";
    for (const id of ["#stats", "#feed", "#bars", "#source-tabs", "#lead-body"]) $(id).replaceChildren();
    $("#more").hidden = true;
    $("#lead-card").hidden = true;
    return;
  }

  const city = CITIES[state.city];
  $("#zip-sub").textContent = `${city.name} · last ${days === 365 ? "12 months" : days + " days"} of public records`;
  status.className = "status loading";
  status.textContent = `Reading ${city.name} open data…`;
  $("#stats").replaceChildren(...city.sources.map((s) => el("div", { class: "stat skeleton" }, el("b", {}, "–"), el("span", {}, s.stat))));

  const since = isoDaysAgo(days);
  const settled = await Promise.allSettled(city.sources.map((s) => s.load(zip, since)));
  if (req !== state.req) return;

  state.results = city.sources.map((s, i) => ({
    source: s,
    items: settled[i].status === "fulfilled" ? settled[i].value.map((it) => ({ ...it, source: s })) : [],
    error: settled[i].status === "rejected" ? settled[i].reason : null,
  }));

  const errs = state.results.filter((r) => r.error);
  const total = state.results.reduce((n, r) => n + r.items.length, 0);
  if (errs.length === state.results.length) {
    status.className = "status error";
    status.textContent = "The city data portal didn't answer. Try again in a minute.";
  } else if (errs.length) {
    status.className = "status error";
    status.textContent = `Couldn't reach: ${errs.map((e) => e.source.label).join(", ")}. Showing the rest.`;
  } else if (!total) {
    status.className = "status";
    status.textContent = "No pest records in this window. Try a longer one.";
  } else {
    status.className = "status";
    status.textContent = "";
  }
  render();
}

function allItems() {
  return state.results
    .filter((r) => state.tab === "all" || r.source.id === state.tab)
    .flatMap((r) => r.items)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function render() {
  // Stats
  $("#stats").replaceChildren(
    ...state.results.map((r) =>
      el("div", { class: "stat" + (r.error ? " stat-err" : "") },
        el("b", {}, r.error ? "n/a" : r.items.reduce((n, it) => n + (it.count || 1), 0).toLocaleString()),
        el("span", {}, r.source.stat))
    )
  );

  // Tabs
  const tabs = [{ id: "all", label: "All" }, ...state.results.map((r) => ({ id: r.source.id, label: r.source.label }))];
  $("#source-tabs").replaceChildren(
    ...tabs.map((t) => {
      const b = el("button", { type: "button", role: "tab", class: "tab" + (state.tab === t.id ? " is-on" : ""), "aria-selected": String(state.tab === t.id) }, t.label);
      b.addEventListener("click", () => { state.tab = t.id; state.shown = 12; render(); });
      return b;
    })
  );

  // Feed
  const items = allItems();
  $("#feed").replaceChildren(
    ...items.slice(0, state.shown).map((it) =>
      el("li", { class: "rec" },
        el("div", { class: "rec-date" }, el("b", {}, fmtDate(it.date)), el("span", {}, daysAgo(it.date))),
        el("div", { class: "rec-body" },
          el("div", { class: "rec-top" }, el("span", { class: "rec-title" }, it.title), [...it.pests].map(pestTag)),
          el("div", { class: "rec-meta" }, [it.where, it.kind, it.detail].filter(Boolean).join(" · ")),
        ),
        el("a", { class: "rec-src", href: it.url, target: "_blank", rel: "noopener" }, "Source")
      )
    )
  );
  if (!items.length && state.results.length) $("#feed").append(el("li", { class: "empty" }, "Nothing in this window."));
  $("#more").hidden = items.length <= state.shown;
  $("#more").textContent = `Show more (${items.length - state.shown} left)`;

  // Bars by pest, across all sources
  const counts = {};
  for (const r of state.results) for (const it of r.items) for (const p of it.pests) counts[p] = (counts[p] || 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  $("#bars").replaceChildren(
    ...rows.map(([p, n]) =>
      el("div", { class: "bar" },
        el("span", { class: "bar-label" }, PESTS[p].label),
        el("span", { class: "bar-track" }, el("i", { style: `width:${Math.max(3, (n / max) * 100)}%;background:${PESTS[p].color}` })),
        el("span", { class: "bar-n" }, n.toLocaleString()))
    )
  );
  if (!rows.length) $("#bars").append(el("p", { class: "muted" }, "No pest records yet."));

  renderLead();
}

// Build the sample lead a pro would receive: the most recent business citation, else a building, else a block.
function renderLead() {
  const card = $("#lead-card");
  const all = state.results.flatMap((r) => r.items);
  const pick = (kind) => all.filter((i) => i.lead === kind).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const realPest = all.filter((i) => i.lead !== "block" && ![...i.pests].every((p) => p === "entry"));
  const lead = realPest.sort((a, b) => (a.date < b.date ? 1 : -1))[0] || pick("business") || pick("landlord") || pick("block");
  if (!lead) { card.hidden = true; return; }
  card.hidden = false;

  const blockCount = all.filter((i) => i.lead === "block").length;
  const pests = [...lead.pests];
  const who = { business: "Business owner", landlord: "Building owner / manager", block: "Owners on the block" }[lead.lead];
  const why = {
    business: "Cited by the health department. A clean reinspection depends on treatment and exclusion now.",
    landlord: "The city ordered the owner to clear the infestation. Treatment reports help close the order.",
    block: "Neighbors are reporting rodents. Owners nearby are likely to want baiting and exclusion.",
  }[lead.lead];

  $("#lead-body").replaceChildren(
    el("div", { class: "lead-top" },
      el("span", { class: "lead-score" }, lead.lead === "block" ? "Warm" : "Hot"),
      el("span", { class: "muted" }, `${daysAgo(lead.date)} · ${state.zip}`)),
    el("p", { class: "lead-title" }, lead.title),
    lead.where ? el("p", { class: "muted lead-where" }, lead.where) : null,
    el("div", { class: "lead-pests" }, pests.map(pestTag)),
    el("dl", {},
      el("dt", {}, "Who to reach"), el("dd", {}, who),
      el("dt", {}, "Why now"), el("dd", {}, why),
      el("dt", {}, "Record"), el("dd", {}, `${lead.kind}, ${fmtDate(lead.date)}`),
      el("dt", {}, "Nearby signal"), el("dd", {}, `${blockCount} rodent complaint${blockCount === 1 ? "" : "s"} in ${state.zip} this window`)),
    el("p", { class: "lead-foot" }, "Sent to one licensed pro covering this zip and pest.")
  );
}

// ---------------------------------------------------------------- wiring

document.addEventListener("DOMContentLoaded", () => {
  const input = $("#zip-input");
  const params = new URLSearchParams(location.search);
  const start = /^\d{5}$/.test(params.get("zip") || "") ? params.get("zip") : "10003";
  input.value = start;

  $("#zip-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const z = input.value.trim();
    if (!/^\d{5}$/.test(z)) { input.focus(); return; }
    load(z, state.days);
    $("#zip").scrollIntoView({ behavior: "smooth" });
  });
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 5); });

  document.querySelectorAll(".chip[data-zip]").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.dataset.zip; load(b.dataset.zip, state.days); $("#zip").scrollIntoView({ behavior: "smooth" }); })
  );
  document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => load(state.zip, +b.dataset.days)));
  $("#more").addEventListener("click", () => { state.shown += 12; render(); });

  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const side = f.get("side") === "pro" ? "Pest control pro" : "Needs a pro";
    const body = [`Side: ${side}`, `Name: ${f.get("name")}`, `Company or property: ${f.get("org") || ""}`, `Zips: ${f.get("zips")}`, `Contact: ${f.get("contact")}`].join("\n");
    location.href = `mailto:ross@buusystems.com?subject=${encodeURIComponent("PestLeadWire: " + side)}&body=${encodeURIComponent(body)}`;
  });

  load(start, 90);
});
