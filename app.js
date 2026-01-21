/* Meeting Notes App (no build tools)
   - Loads /notes/notes.json
   - Fetches each .txt note
   - Renders "Heading:" + "- bullets" format
   - Supports filename filter + global content search + in-note search
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
};

let notes = []; // { id, filename, title, dateKey, text, blocks }
let activeNoteId = null;

// ---------- Utilities ----------
function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeQuery(q) {
  return (q || "").trim().toLowerCase();
}

function dateKeyFromFilename(filename) {
  // Handles "YYYY-MM-DD.txt" or "YYYY-M-D.txt" etc. Extracts and zero-pads.
  const base = filename.replace(/\.txt$/i, "");
  const m = base.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return base;
  const yyyy = m[1];
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  const dd = String(parseInt(m[3], 10)).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function prettyDate(dateKey) {
  // dateKey "YYYY-MM-DD"
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function highlightHtml(html, query) {
  const q = normalizeQuery(query);
  if (!q) return html;

  // Best-effort highlighting on rendered HTML:
  // split by tags and only highlight text chunks to avoid breaking markup.
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
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

// ---------- Parsing ----------
function parseNoteToBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let currentSection = null; // { type: 'section', title, items, paragraphs }

  function flushSection() {
    if (!currentSection) return;
    blocks.push(currentSection);
    currentSection = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();

    if (!trimmed) {
      // blank line ends any running bullet list inside the section, but we can keep the section open
      // We won't auto-flush section here to allow multiple paragraphs.
      continue;
    }

    const isHeading = trimmed.endsWith(":") && !trimmed.startsWith("-");

    if (isHeading) {
      // New section
      flushSection();
      currentSection = {
        type: "section",
        title: trimmed.slice(0, -1),
        items: [],
        paragraphs: [],
      };
      continue;
    }

    const isBullet = trimmed.startsWith("- ");
    if (isBullet) {
      if (!currentSection) {
        currentSection = { type: "section", title: "Notes", items: [], paragraphs: [] };
      }
      currentSection.items.push(trimmed.slice(2));
      continue;
    }

    // Paragraph line
    if (!currentSection) {
      currentSection = { type: "section", title: "Notes", items: [], paragraphs: [] };
    }
    currentSection.paragraphs.push(trimmed);
  }

  flushSection();

  // If nothing parsed (empty file), return a single empty section
  if (blocks.length === 0) {
    return [{ type: "section", title: "Notes", items: [], paragraphs: [] }];
  }

  return blocks;
}

function renderBlocksToHtml(blocks) {
  return blocks
    .map((b) => {
      const title = escapeHtml(b.title || "Notes");
      const paras = (b.paragraphs || [])
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("");

      const items = (b.items || [])
        .map((it) => `<li>${escapeHtml(it)}</li>`)
        .join("");

      const listHtml = items ? `<ul>${items}</ul>` : "";
      return `<div class="section"><h2>${title}</h2>${paras}${listHtml}</div>`;
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
      const hitsBadge = globalQ
        ? `<span class="badge">🔎 <span>${n.hits} hit${n.hits === 1 ? "" : "s"}</span></span>`
        : "";
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
      setActiveNote(id);
    });
  });

  // If active note got filtered out, keep main pane but no highlight in list
}

function setActiveNote(id) {
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

// ---------- Data loading ----------
async function loadNotes() {
  // notes.json must be a JSON array of filenames
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
        blocks: parseNoteToBlocks(text),
      };
    })
  );

  // Sort newest first by dateKey
  notes = fetched.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

// ---------- Events ----------
function wireEvents() {
  els.filenameFilter.addEventListener("input", () => renderFileList());

  els.globalSearch.addEventListener("input", () => {
    renderFileList();
    // If there is an active note, keep it displayed as-is
  });

  els.inNoteSearch.addEventListener("input", () => renderActiveNoteWithHighlight());

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd+K focuses global search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      els.globalSearch.focus();
    }
    // Ctrl/Cmd+F focuses in-note search if enabled
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      if (!els.inNoteSearch.disabled) {
        e.preventDefault();
        els.inNoteSearch.focus();
      }
    }
  });
}

// ---------- Boot ----------
(async function init() {
  wireEvents();
  try {
    await loadNotes();
    renderFileList();

    // Auto-select newest note
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
