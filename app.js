"use strict";

// Reads data/snapshot.json (built by scripts/snapshot.py from the PestLeadWire app's feeds):
// counts near a ZIP, the three closest businesses, and coverage by market.

const $ = (s) => document.querySelector(s);
let DATA = null;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== "") n.append(k.nodeType ? k : String(k));
  return n;
}

function titleCase(s) {
  // Feeds shout ("NOODLES PHO U +"); leave mixed-case names alone.
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/'S\b/g, "'s") : s;
}

function sentence(s) {
  s = (s || "").trim();
  if (s === s.toUpperCase()) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(iso, withYear) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}

async function loadData() {
  if (DATA) return DATA;
  const res = await fetch("/data/snapshot.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("snapshot " + res.status);
  DATA = await res.json();
  return DATA;
}

function showZip(zip) {
  const status = $("#zip-status");
  const result = $("#zip-result");
  $("#form-zip").value = zip;
  history.replaceState(null, "", `?zip=${zip}${location.hash}`);
  $("#zip-title").textContent = `Near ${zip}`;

  const hit = DATA.zips[zip];
  if (!hit) {
    result.hidden = true;
    $("#zip-sub").textContent = "No public inspection feed reaches this ZIP yet.";
    status.className = "status";
    status.replaceChildren(
      "We cover a place when its health department publishes inspection details, and yours doesn't yet. ",
      el("a", { href: "#sample" }, "Send us your ZIP"),
      " and we'll tell you when it goes live."
    );
    return;
  }

  const [mid, count, ex] = hit;
  const m = DATA.markets[mid];
  status.className = "status";
  status.textContent = "";
  result.hidden = false;
  $("#zip-sub").textContent = `${m.label}, ${m.state} market`;
  $("#near-count").textContent = count.toLocaleString();
  $("#near-label").textContent = `business${count === 1 ? "" : "es"} cited for pest problems within ${DATA.radius} miles in the last ${DATA.days} days`;
  $("#near-market").textContent = count
    ? `Your list would start with the closest ones. Want a wider circle? Tell us how far you drive.`
    : `None inside ${DATA.radius} miles in this window. Most shops drive further: tell us your radius.`;

  const rows = ex.map(([i, mi]) => ({ ...DATA.examples[i], mi }));
  renderMock(rows);
}

function renderMock(rows) {
  if (!rows.length) {
    $("#mock-rows").replaceChildren(el("tr", {}, el("td", { colspan: "7", class: "empty" }, "Nothing inside the circle in this window.")));
    return;
  }
  $("#mock-rows").replaceChildren(
    ...rows.map((r) =>
      el("tr", {},
        el("td", { class: "b" }, titleCase(r.name)),
        el("td", { class: "redact" }, "(•••) •••-••••"),
        el("td", { class: "redact" }, "••• •••••• St, " + titleCase(r.city)),
        el("td", {}, String(r.mi)),
        el("td", {}, r.type || ""),
        el("td", {}, fmtDate(r.date)),
        el("td", {}, sentence(r.found)))
    )
  );
}

function renderCoverage() {
  const byState = {};
  for (const [id, m] of Object.entries(DATA.markets)) (byState[m.state] ||= []).push(m);
  const names = { CA: "California", DE: "Delaware", FL: "Florida", IL: "Illinois", MA: "Massachusetts", MD: "Maryland", MI: "Michigan",
    MN: "Minnesota", NC: "North Carolina", NV: "Nevada", NY: "New York", OH: "Ohio", WA: "Washington" };
  const states = Object.keys(byState).sort((a, b) => (names[a] || a).localeCompare(names[b] || b));
  $("#markets").replaceChildren(
    ...states.map((st) =>
      el("div", { class: "state" },
        el("h3", {}, names[st] || st),
        el("ul", {}, byState[st].sort((a, b) => b.count - a.count).map((m) =>
          el("li", {}, el("span", {}, m.label), el("b", { title: `cited in the last ${DATA.days} days` }, m.count.toLocaleString()))))
      )
    )
  );
  const total = Object.values(DATA.markets).length;
  const set = (k, v) => { const n = document.querySelector(`[data-stat="${k}"]`); if (n) n.textContent = v; };
  set("total", DATA.total.toLocaleString());
  set("markets", String(total));
  set("states", String(states.length));
  $("#asof").textContent = `records pulled ${fmtDate(DATA.asof, true)}, inspections from the ${DATA.days} days before`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const input = $("#zip-input");
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 5); });

  const go = (z, scroll) => {
    if (!/^\d{5}$/.test(z)) { input.focus(); return; }
    input.value = z;
    if (DATA) showZip(z);
    if (scroll) $("#zip").scrollIntoView({ behavior: "smooth" });
  };
  $("#zip-form").addEventListener("submit", (e) => { e.preventDefault(); go(input.value.trim(), true); });
  document.querySelectorAll(".chip[data-zip]").forEach((b) => b.addEventListener("click", () => go(b.dataset.zip, true)));

  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const lines = [
      `Name: ${f.get("name")}`, `Company: ${f.get("company")}`, `Shop ZIP: ${f.get("zip")}`, `Radius: ${f.get("radius")}`,
      `Email: ${f.get("email")}`, `Phone: ${f.get("phone") || ""}`, "", "Please send me the free sample list.",
    ];
    location.href = `mailto:pestleadwire@gmail.com?subject=${encodeURIComponent(`Free sample list: ${f.get("company")} (${f.get("zip")})`)}&body=${encodeURIComponent(lines.join("\n"))}`;
  });

  try {
    await loadData();
  } catch (err) {
    $("#zip-status").className = "status error";
    $("#zip-status").textContent = "Couldn't load the latest counts. Try reloading the page.";
    return;
  }
  renderCoverage();
  const q = new URLSearchParams(location.search).get("zip");
  go(/^\d{5}$/.test(q || "") ? q : "60614", false);
});
