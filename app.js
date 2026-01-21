/* Meeting Notes App (no build tools)
   - Loads /notes/notes.json
   - Fetches each .txt note
   - Renders "Heading:" + "- bullets" format
   - Supports filename filter + global content search + in-note search
   - Generator index created from section headings (deduplicated by normalized key)
   - Detects "Power Cycle:" sections and lists dates per generator (matched by normalized key)
*/

const els = {
  fileList: document.getElementById("fileList"),
  filenameFilter: document.getElementById("filenameFilter"),
  globalSearch: document.getElementById("globalSearch"),
  globalSearchMeta: document.getElementById("globalSearchMeta"),
  noteTitle: document.getElementById("noteTitle"),
  noteSubtitle: document.getElementById("noteSubtitle"),
  inNoteSearch: document.getElementById("inNoteSearch"),
  inNoteMeta: document.getElementById("inNoteMeta"),
  noteContent: document.getElementById("noteContent"),
  generatorsView: document.getElementById("generatorsView"),
  generatorList: document.getElementById("generatorList"),
  generatorMentions: document.getElementById("generatorMentions"),
  generatorsEmpty: document.getElementById("generatorsEmpty"),
  tabNotes: document.getElementById("tabNotes"),
  tabGenerators: document.getElementById("tabGenerators"),
};

let notes = []; // { id, filename, dateKey, text, blocks }
let notesByDateKey = {}; // dateKey -> noteId
let activeNoteId = null;

// Generators:
// - keyed by normalized name: generatorsIndex[genKey] = [{...mentions}]
let generatorsIndex = {};
// map genKey -> canonical display name (first seen)
let generatorsDisplay = {};
// powerCyclesMap keyed by normalized site name (matching genKey ideally)
let powerCyclesMap = {}; // key -> [{ dateKey, noteId, filename, raw }]

// ---------- Utilities ----------
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeQuery(q) {
  return (q || "").trim().toLowerCase();
}

function normalizeNameKey(s) {
  // Normalize text for matching: lowercase, remove non-alnum.
  // Keep inner digits/letters, strip punctuation/whitespace.
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function dateKeyFromFilename(filename) {
  const base = filename.replace(/\.txt$/i, "");
  const m = base.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return base;
  const yyyy = m[1];
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  const dd = String(parseInt(m[3], 10)).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function prettyDate(dateKey) {
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function slugFor(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function highlightHtml(html, query) {
  const q = normalizeQuery(query);
  if (!q) return html;
  const parts = html.split(/(<[^>]+>)/g);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return parts
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part.replace(re, (m) => `<mark>${m}</mark>`);
    })
    .join("");
}

function countOccurrences(text, query) {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches = String(text || "").match(re);
  return matches ? matches.length : 0;
}

// ---------- Parsing ----------
function parseNoteToBlocks(text, filename) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let currentSection = null;

  function flushSection() {
    if (!currentSection) return;
    if (!currentSection.id) {
      const base = currentSection.title || "notes";
      currentSection.id = slugFor(`${filename}-${base}`);
    }
    blocks.push(currentSection);
    currentSection = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const isHeading = trimmed.endsWith(":") && !trimmed.startsWith("-");

    if (isHeading) {
      flushSection();
      currentSection = {
        type: "section",
        title: trimmed.slice(0, -1),
        items: [],
        paragraphs: [],
        id: null,
      };
      continue;
    }

    const isBullet = trimmed.startsWith("- ");
    if (isBullet) {
      if (!currentSection) {
        currentSection = { type: "section", title: "Notes", items: [], paragraphs: [], id: null };
      }
      currentSection.items.push(trimmed.slice(2));
      continue;
    }

    if (!currentSection) {
      currentSection = { type: "section", title: "Notes", items: [], paragraphs: [], id: null };
    }
    currentSection.paragraphs.push(trimmed);
  }

  flushSection();

  if (blocks.length === 0) {
    return [{ type: "section", title: "Notes", items: [], paragraphs: [], id: slugFor(`${filename}-notes`) }];
  }

  return blocks;
}

function renderBlocksToHtml(blocks) {
  return blocks
    .map((b) => {
      const title = escapeHtml(b.title || "Notes");
      const paras = (b.paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      const items = (b.items || []).map((it) => `<li>${escapeHtml(it)}</li>`).join("");
      const listHtml = items ? `<ul>${items}</ul>` : "";
      return `<div class="section" id="${escapeHtml(b.id)}"><h2>${title}</h2>${paras}${listHtml}</div>`;
    })
    .join("");
}

// ---------- Rendering ----------
function renderFileList() {
  const filter = normalizeQuery(els.filenameFilter.value);
  const globalQ = normalizeQuery(els.globalSearch.value);

  const filtered = notes
    .filter((n) => {
      if (!filter) return true;
      return n.filename.toLowerCase().includes(filter) || n.dateKey.toLowerCase().includes(filter);
    })
    .map((n) => {
      const hits = globalQ ? countOccurrences(n.text.toLowerCase(), globalQ) : 0;
      return { ...n, hits };
    })
    .filter((n) => (globalQ ? n.hits > 0 : true))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  els.fileList.innerHTML = filtered
    .map((n) => {
      const active = n.id === activeNoteId ? "active" : "";
      const subtitle = prettyDate(n.dateKey);
      const hitsBadge = globalQ ? `<span class="badge">🔎 <span>${n.hits} hit${n.hits === 1 ? "" : "s"}</span></span>` : "";
      return `
        <div class="file-item ${active}" role="listitem" data-id="${n.id}">
          <div class="file-name">${escapeHtml(n.dateKey)}</div>
          <div class="file-sub">
            <span class="badge">📄 <span>${escapeHtml(n.filename)}</span></span>
            <span class="badge">🗓️ <span>${escapeHtml(subtitle)}</span></span>
            ${hitsBadge}
          </div>
        </div>
      `;
    })
    .join("");

  els.globalSearchMeta.textContent = globalQ
    ? `${filtered.length} note${filtered.length === 1 ? "" : "s"} matched`
    : `${notes.length} total note${notes.length === 1 ? "" : "s"}`;

  // click handlers
  els.fileList.querySelectorAll(".file-item").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-id");
      showView("notes");
      setActiveNote(id);
    });
  });
}

function setActiveNote(id, targetSectionId = null) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;

  activeNoteId = id;

  els.noteTitle.textContent = note.dateKey;
  els.noteSubtitle.textContent = `${note.filename} • ${prettyDate(note.dateKey)}`;

  els.inNoteSearch.disabled = false;
  els.inNoteSearch.value = "";
  els.inNoteMeta.textContent = "";

  const baseHtml = renderBlocksToHtml(note.blocks);
  els.noteContent.innerHTML = baseHtml;

  if (targetSectionId) {
    setTimeout(() => jumpToSection(targetSectionId), 50);
  }

  renderFileList();
}

function renderActiveNoteWithHighlight() {
  const note = notes.find((n) => n.id === activeNoteId);
  if (!note) return;

  const q = normalizeQuery(els.inNoteSearch.value);
  const baseHtml = renderBlocksToHtml(note.blocks);
  const highlighted = highlightHtml(baseHtml, q);

  els.noteContent.innerHTML = highlighted;

  const hits = q ? countOccurrences(note.text.toLowerCase(), q) : 0;
  els.inNoteMeta.textContent = q ? `${hits} hit${hits === 1 ? "" : "s"}` : "";
}

// ---------- Generators & Power Cycle indexing ----------
function buildGeneratorsAndPowerCycles() {
  generatorsIndex = {};
  generatorsDisplay = {};
  powerCyclesMap = {};

  // Reserved headings we do NOT want to treat as generators:
  const reserved = new Set(["power cycle", "powercycle"]);

  notes.forEach((n) => {
    // 1) Use every section heading as a generator name UNLESS it's reserved.
    n.blocks.forEach((b) => {
      if (!b.title) return;
      const titleTrim = b.title.trim();
      const keyLower = titleTrim.toLowerCase();
      if (reserved.has(keyLower)) return; // skip reserved headings

      // normalize key for deduplication
      const genKey = normalizeNameKey(titleTrim);
      if (!genKey) return;
      // set canonical display name on first occurrence
      if (!generatorsDisplay[genKey]) generatorsDisplay[genKey] = titleTrim;

      if (!generatorsIndex[genKey]) generatorsIndex[genKey] = [];
      generatorsIndex[genKey].push({
        noteId: n.id,
        filename: n.filename,
        dateKey: n.dateKey,
        sectionId: b.id,
        snippet: snippetFromSection(b),
      });
    });

    // 2) power cycle sections: collect each bullet as a power-cycle item for that date
    n.blocks.forEach((b) => {
      if (!b.title) return;
      if (/^power\s*cycle$/i.test(b.title.trim())) {
        (b.items || []).forEach((itemRaw) => {
          const item = String(itemRaw || "").trim();
          if (!item) return;
          const key = normalizeNameKey(item);
          if (!powerCyclesMap[key]) powerCyclesMap[key] = [];
          powerCyclesMap[key].push({ dateKey: n.dateKey, noteId: n.id, filename: n.filename, raw: item });
        });
      }
    });
  });

  // sort mentions and power cycles
  Object.keys(generatorsIndex).forEach((k) => {
    generatorsIndex[k].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  });
  Object.keys(powerCyclesMap).forEach((k) => {
    powerCyclesMap[k].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  });
}

// find matching power cycle entries for a generator key (with fallback)
function findPowerCyclesForGeneratorKey(genKey) {
  const matches = [];

  // direct key
  if (powerCyclesMap[genKey]) {
    matches.push(...powerCyclesMap[genKey]);
  }

  // fallback: include any powerCyclesMap key that contains genKey or is contained by genKey
  if (!matches.length) {
    for (const k of Object.keys(powerCyclesMap)) {
      if (!k) continue;
      if (k.includes(genKey) || genKey.includes(k)) {
        matches.push(...powerCyclesMap[k]);
      }
    }
  }

  // dedupe by dateKey
  const seen = new Set();
  const out = [];
  for (const p of matches) {
    if (seen.has(p.dateKey)) continue;
    seen.add(p.dateKey);
    out.push(p);
  }

  // sort descending date
  out.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return out;
}

function snippetFromSection(section) {
  const all = [].concat(section.paragraphs || []).concat(section.items || []);
  if (!all.length) return "";
  const s = String(all[0]).slice(0, 140);
  return s + (String(all[0]).length > 140 ? "…" : "");
}

function snippetAroundIndex(text, idx, len) {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + len + 40);
  const raw = text.slice(start, end).replace(/\s+/g, " ");
  return raw.length > 140 ? raw.slice(0, 137) + "…" : raw;
}

// ---------- Generators UI ----------
function renderGeneratorsView() {
  buildGeneratorsAndPowerCycles();

  // produce a list of { key, display } sorted by display name
  const items = Object.keys(generatorsIndex)
    .map((k) => ({ key: k, display: generatorsDisplay[k] || k }))
    .sort((a, b) => a.display.localeCompare(b.display));

  if (items.length === 0) {
    els.generatorsEmpty.classList.remove("hidden");
    els.generatorList.innerHTML = "";
    els.generatorMentions.classList.add("hidden");
    return;
  }
  els.generatorsEmpty.classList.add("hidden");
  els.generatorMentions.classList.add("hidden");

  els.generatorList.innerHTML = items
    .map(({ key, display }) => {
      const count = generatorsIndex[key].length;
      const powerCycles = findPowerCyclesForGeneratorKey(key);
      const pcCount = powerCycles.length;
      const pcBadge = pcCount ? `<span class="badge">⚡ ${pcCount}</span>` : "";
      return `<div class="generator-card" data-genkey="${escapeHtml(key)}">
        <div>
          <div class="gen-name">${escapeHtml(display)}</div>
          <div class="meta" style="margin-top:6px;color:var(--muted);font-size:12px">${count} mention${count===1?"":"s"} ${pcBadge ? '• ' + pcBadge : ''}</div>
        </div>
        <div class="badge">${count} mention${count===1?"":"s"}</div>
      </div>`;
    })
    .join("");

  // wire clicks
  els.generatorList.querySelectorAll(".generator-card").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.getAttribute("data-genkey");
      showGeneratorMentionsByKey(key);
    });
  });
}

function showGeneratorMentionsByKey(genKey) {
  const mentions = generatorsIndex[genKey] || [];
  const powerCycles = findPowerCyclesForGeneratorKey(genKey);
  const display = generatorsDisplay[genKey] || genKey;

  if (!mentions.length && !powerCycles.length) return;

  let mentionsHtml = "";
  if (mentions.length) {
    mentionsHtml = `
      <h2 style="margin-top:0">${escapeHtml(display)}</h2>
      ${mentions
        .map((m) => {
          const when = prettyDate(m.dateKey);
          const sectionLabel = m.sectionId ? `Section` : `Inline`;
          return `
            <div class="mention-item" data-noteid="${m.noteId}" data-section="${m.sectionId || ""}">
              <div><strong>${escapeHtml(m.filename)}</strong> • <span class="meta">${escapeHtml(when)} • ${sectionLabel}</span></div>
              <div style="margin-top:8px;color:var(--muted)">${escapeHtml(m.snippet)}</div>
            </div>
          `;
        })
        .join("")}
    `;
  }

  let powerHtml = "";
  if (powerCycles.length) {
    powerHtml = `
      <div style="margin-top:12px">
        <h3 style="margin:6px 0 8px 0">Power cycles</h3>
        <div>
          ${powerCycles
            .map((p) => {
              return `<div class="mention-item power-date" data-date="${escapeHtml(p.dateKey)}" data-noteid="${escapeHtml(p.noteId)}">
                <div><strong>${escapeHtml(prettyDate(p.dateKey))}</strong> • <span class="meta">${escapeHtml(p.filename)}</span></div>
                <div style="margin-top:6px;color:var(--muted);font-size:13px">Site: ${escapeHtml(p.raw || "")}</div>
              </div>`;
            })
            .join("")}
        </div>
      </div>
    `;
  } else {
    powerHtml = `
      <div style="margin-top:12px">
        <h3 style="margin:6px 0 8px 0">Power cycles</h3>
        <div class="empty-state small" style="padding:10px;border-radius:8px">No power cycles recorded for this generator.</div>
      </div>
    `;
  }

  els.generatorMentions.innerHTML = `${mentionsHtml}${powerHtml}`;
  els.generatorMentions.classList.remove("hidden");

  // wire mention clicks to open the note and jump to section
  els.generatorMentions.querySelectorAll(".mention-item").forEach((el) => {
    el.addEventListener("click", () => {
      const noteId = el.getAttribute("data-noteid");
      const section = el.getAttribute("data-section") || null;
      showView("notes");
      setActiveNote(noteId, section);
    });
  });

  // wire power-date clicks to open the note of that date
  els.generatorMentions.querySelectorAll(".power-date").forEach((el) => {
    el.addEventListener("click", () => {
      const noteId = el.getAttribute("data-noteid");
      showView("notes");
      setActiveNote(noteId);
    });
  });
}

// ---------- Jump to / highlight section ----------
function jumpToSection(sectionId) {
  if (!sectionId) return;
  const el = document.getElementById(sectionId);
  if (!el) return;
  document.querySelectorAll(".section.highlight").forEach((s) => s.classList.remove("highlight"));
  el.classList.add("highlight");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => el.classList.remove("highlight"), 2400);
}

// ---------- Events ----------
function wireEvents() {
  els.filenameFilter.addEventListener("input", () => renderFileList());
  els.globalSearch.addEventListener("input", () => {
    renderFileList();
  });
  els.inNoteSearch.addEventListener("input", () => renderActiveNoteWithHighlight());

  els.tabNotes.addEventListener("click", () => showView("notes"));
  els.tabGenerators.addEventListener("click", () => {
    buildGeneratorsAndPowerCycles();
    renderGeneratorsView();
    showView("generators");
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      els.globalSearch.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      if (!els.inNoteSearch.disabled) {
        e.preventDefault();
        els.inNoteSearch.focus();
      }
    }
  });
}

function showView(viewName) {
  if (viewName === "generators") {
    els.noteContent.classList.add("hidden");
    els.generatorsView.classList.remove("hidden");
    els.tabGenerators.classList.add("active");
    els.tabNotes.classList.remove("active");
  } else {
    els.noteContent.classList.remove("hidden");
    els.generatorsView.classList.add("hidden");
    els.tabGenerators.classList.remove("active");
    els.tabNotes.classList.add("active");
  }
}

// ---------- Data loading ----------
async function loadNotes() {
  const res = await fetch("./notes/notes.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load notes.json (${res.status})`);
  }

  const filenames = await res.json();
  if (!Array.isArray(filenames)) {
    throw new Error("notes.json must be a JSON array of filenames.");
  }

  const fetched = await Promise.all(
    filenames.map(async (filename) => {
      const noteRes = await fetch(`./notes/${encodeURIComponent(filename)}`, { cache: "no-store" });
      if (!noteRes.ok) {
        throw new Error(`Failed to load note: ${filename} (${noteRes.status})`);
      }
      const text = await noteRes.text();
      const dateKey = dateKeyFromFilename(filename);
      return {
        id: crypto.randomUUID(),
        filename,
        dateKey,
        text,
        blocks: parseNoteToBlocks(text, filename),
      };
    })
  );

  notes = fetched.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  notesByDateKey = {};
  notes.forEach((n) => {
    notesByDateKey[n.dateKey] = n.id;
  });
}

// ---------- Boot ----------
(async function init() {
  wireEvents();
  try {
    await loadNotes();
    renderFileList();
    if (notes.length > 0) {
      setActiveNote(notes[0].id);
    }
  } catch (err) {
    els.noteContent.innerHTML = `
      <div class="empty-state">
        <p><strong>Could not load notes.</strong></p>
        <p class="small">${escapeHtml(String(err.message || err))}</p>
        <p class="small">
          Make sure you have <code>/notes/notes.json</code> and at least one <code>.txt</code> file.
        </p>
      </div>
    `;
    els.globalSearchMeta.textContent = "Error loading notes";
  }
})();
