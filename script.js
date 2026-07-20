// ---- Image path configuration ----
// Your XML <graphic href="..."> values only contain a filename or id
// (e.g. "fig1" or "fig1.png"), while the actual image files live in a
// separate folder next to index.html. Set that folder path here.
// Example: if your folder structure is:
//   Cus_XML_Bview/
//     index.html
//     script.js
//     images/fig1.png
// then IMAGE_BASE_PATH should be 'images/'
const IMAGE_BASE_PATH = 'images/';

// Some JATS graphic hrefs omit the file extension. List the extensions to
// try, in order, when the href has none. The first one is used as the
// initial src; onerror-based fallback for the rest is handled separately
// if needed, but usually one consistent extension is enough.
const DEFAULT_IMAGE_EXTENSION = '.png';

function resolveImagePath(href) {
    if (!href) return href;
    // Already a full URL or absolute path — use as-is.
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('/')) return href;

    // Normalize Windows-style backslashes to forward slashes for the web.
    let cleanHref = href.replace(/\\/g, '/');

    // If href has no file extension, append the default one.
    const hasExtension = /\.[a-z0-9]{2,4}$/i.test(cleanHref);
    if (!hasExtension) {
        cleanHref = cleanHref + DEFAULT_IMAGE_EXTENSION;
    }

    // Avoid double-prefixing if the href already includes the base path.
    if (IMAGE_BASE_PATH && !cleanHref.startsWith(IMAGE_BASE_PATH)) {
        return IMAGE_BASE_PATH + cleanHref;
    }
    return cleanHref;
}

// Shared inline style for the "boxed label" look (used for Figure/Table/
// Chart/Scheme/Plate labels, affiliation numbers, corresponding-author
// markers, and reference numbers), matching the bordered-field appearance
// seen in the source document.
const CAPTION_LABEL_BOX_STYLE = 'border:1px solid #1f2937; padding:1px 6px; font-weight:700; display:inline-block; margin-right:2px;';

// ---- New-tab viewer configuration ----
// Key used to hand the uploaded XML content off to the viewer page via
// localStorage (works across tabs opened from the same origin/folder).
const XML_STORAGE_KEY = 'customerXmlContent';
const VIEWER_PAGE_URL = 'viewer.html';

function loadXML(targetWindow) {
    const fileInput = document.getElementById('xmlFile');
    if (!fileInput) { console.error('No #xmlFile element found'); logError('No #xmlFile element found'); alert('Internal error: file input missing'); return; }
    const file = fileInput.files && fileInput.files[0];
    console.log('loadXML called', file && file.name);
    if (!file) {
        alert('Please select an XML file.');
        if (targetWindow && !targetWindow.closed) targetWindow.close();
        return;
    }
    setStatus(`Reading ${file.name}...`);

    try {
        const reader = new FileReader();
        reader.onload = function (event) {
            const xmlString = event.target.result;
            setStatus('File read. Opening viewer...');
            openInViewerTab(xmlString, targetWindow);
        };
        reader.onerror = function (err) {
            console.error('FileReader error', err);
            logError('FileReader error: ' + String(err));
            setStatus('FileReader error');
            showError('Failed to read file');
            if (targetWindow && !targetWindow.closed) targetWindow.close();
        };
        reader.readAsText(file);
    } catch (err) {
        console.error('loadXML exception', err);
        logError('loadXML exception: ' + String(err));
        setStatus('loadXML exception');
        showError('Failed to read file');
        if (targetWindow && !targetWindow.closed) targetWindow.close();
    }
}

// Stores the uploaded XML text where the viewer page can find it, then
// navigates to (or opens) the viewer page so the rendered article shows up
// in its own browser tab instead of inline below the upload box.
//
// `targetWindow` should be a window reference already opened *synchronously*
// inside the click/change handler (before the async FileReader read
// finishes), so browsers don't treat this as a blocked popup.
function openInViewerTab(xmlString, targetWindow) {
    try {
        localStorage.setItem(XML_STORAGE_KEY, xmlString);
    } catch (err) {
        console.error('Failed to store XML for viewer tab', err);
        logError('Failed to store XML for viewer tab: ' + String(err));
        showError('Could not hand off the file to the viewer tab (storage error).');
        if (targetWindow && !targetWindow.closed) targetWindow.close();
        return;
    }

    if (targetWindow && !targetWindow.closed) {
        targetWindow.location.href = VIEWER_PAGE_URL;
    } else {
        // Fallback: targetWindow wasn't provided/valid — try opening now.
        // (May be blocked by the browser's popup blocker since we're no
        // longer inside the original synchronous click handler.)
        const win = window.open(VIEWER_PAGE_URL, '_blank');
        if (!win) {
            setStatus('Popup blocked — please allow popups for this site and try again.');
            return;
        }
    }
    setStatus('Opened in new tab.');
}

function setStatus(txt) {
    try {
        const el = document.getElementById('uploadStatus');
        if (el) el.textContent = txt;
        logDebug('Status: ' + txt);
    } catch (e) {}
}

window.addEventListener('error', (ev) => {
    try {
        console.error(ev.error || ev.message, ev);
    } catch (e) {}
});
window.addEventListener('unhandledrejection', (ev) => {
    try {
        console.error('UnhandledRejection', ev.reason);
    } catch (e) {}
});

// expose a lightweight logger
function logDebug(msg) { try { console.log(msg); } catch (e) {} }
function logWarn(msg) { try { console.warn(msg); } catch (e) {} }
function logError(msg) { try { console.error(msg); } catch (e) {} }

function parseXmlAndRender(xmlString) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
        if (xmlDoc.querySelector && xmlDoc.querySelector('parsererror')) {
            const msg = xmlDoc.querySelector('parsererror').textContent || 'Unknown XML parse error';
            console.error('XML parse error', msg);
            logError('XML parse error: ' + msg);
            showError('XML parsing failed: invalid XML');
            return;
        }
        const article = findFirstElement(xmlDoc, ['article']) || xmlDoc.documentElement;
        // Reset the sequential Figure/Table/Scheme/Chart/Plate label counters
        // so numbering restarts cleanly (Figure 1, Figure 2, ...) each time a
        // new XML file is loaded, regardless of any label already in the XML.
        window.__typeCounters = {};
        // build a reference id -> numeric index map to render numeric citation labels
        try {
            buildReferenceIndex(xmlDoc);
            buildObjectLabelIndex(xmlDoc);
            // Build a single, document-wide set of figure caption "keys" so that
            // duplicate caption paragraphs are detected no matter which section
            // (or nesting level) they or their <fig> sibling live in.
            window.__allFigureCaptionKeys = getAllFigureCaptionKeys(xmlDoc);
        } catch (err) {
            logWarn('buildReferenceIndex/buildObjectLabelIndex failed: ' + String(err));
            window.__refIndex = window.__refIndex || {};
            window.__objectLabelIndex = window.__objectLabelIndex || { fig: {}, table: {} };
            window.__allFigureCaptionKeys = window.__allFigureCaptionKeys || new Set();
        }
        const html = renderTwoColumnArticle(article);
        showHtml(html);
    } catch (err) {
        console.error('parseXmlAndRender exception', err);
        logError('parseXmlAndRender exception: ' + String(err));
        showError('XML parsing failed');
    }
}

function buildReferenceIndex(xmlDoc) {
    const map = {};
    const back = findFirstElement(xmlDoc, ['back']);
    if (!back) { window.__refIndex = map; return map; }
    const refList = findFirstElement(back, ['ref-list', 'citation-list']);
    if (!refList) { window.__refIndex = map; return map; }
    const refs = collectChildElements(refList, ['ref']);
    refs.forEach((ref, i) => {
        const rid = ref.getAttribute('id') || `ref-${i+1}`;
        map[rid] = i + 1;
    });
    window.__refIndex = map;
    return map;
}

function buildObjectLabelIndex(xmlDoc) {
    const map = { fig: {}, table: {}, scheme: {}, chart: {}, plate: {} };
    const nodes = findAllElements(xmlDoc, ['fig', 'table', 'table-wrap', 'scheme', 'chart', 'scheme-wrap', 'chart-wrap', 'plate', 'plate-wrap']);
    for (const node of nodes) {
        const id = node.getAttribute('id') || node.getAttribute('xml:id');
        if (!id) continue;
        const tag = getLocalName(node);
        let type = tag;
        if (tag === 'table-wrap') type = 'table';
        if (tag === 'scheme-wrap') type = 'scheme';
        if (tag === 'chart-wrap') type = 'chart';
        if (tag === 'plate-wrap') type = 'plate';
        const label = getText(findFirstElement(node, ['label']));
        if (!label) continue;
        if (!map[type]) map[type] = {};
        map[type][id] = label;
    }
    window.__objectLabelIndex = map;
    return map;
}

function showError(message) {
    const viewer = document.getElementById('viewerContainer') || document.getElementById('journalContainer') || document.body;
    const body = document.getElementById('articleBody') || viewer;
    try {
        if (viewer !== document.body) viewer.hidden = false;
    } catch (e) {}
    body.innerHTML = `<div class="article-card"><p>${escapeHtml(message)}</p></div>`;
}

function showHtml(html) {
    const viewer = document.getElementById('viewerContainer') || document.getElementById('journalContainer') || document.body;
    const body = document.getElementById('articleBody') || viewer;
    try {
        if (viewer !== document.body) viewer.hidden = false;
    } catch (e) {}
    body.innerHTML = `<div class="citation-popup" id="citationPopup"></div>${html}`;
}

// If this page is the viewer page (has a viewer container but no upload
// file input), automatically pick up the XML handed off by the upload page
// via localStorage and render it.
function autoRenderViewerPage() {
    if (document.getElementById('xmlFile')) return; // this is the upload page
    const container = document.getElementById('viewerContainer') || document.getElementById('journalContainer');
    if (!container) return;

    let xmlString = null;
    try {
        xmlString = localStorage.getItem(XML_STORAGE_KEY);
    } catch (err) {
        logError('Failed to read stored XML: ' + String(err));
    }

    if (!xmlString) {
        try { container.hidden = false; } catch (e) {}
        showError('No XML data found. Please go back to the upload page and upload a file.');
        return;
    }

    parseXmlAndRender(xmlString);
}

document.addEventListener('DOMContentLoaded', () => {
    autoRenderViewerPage();

    const button = document.getElementById('uploadBtn');
    const viewerEl = document.getElementById('viewerContainer') || document.getElementById('journalContainer');
    if (!viewerEl) console.warn('No viewer container found (#viewerContainer or #journalContainer). Output will be inserted into #articleBody or document body.');
    const statusEl = document.getElementById('uploadStatus');
    if (button) {
        button.addEventListener('click', (e) => {
            const inp = document.getElementById('xmlFile');
            if (!inp) { logError('No file input element'); alert('Internal error: file input missing'); return; }
            // If a file is already selected, perform load; otherwise open the file picker
            if (inp.files && inp.files.length) {
                statusEl && (statusEl.textContent = `Loading ${inp.files[0].name}...`);
                // Open the new tab synchronously (inside this click handler)
                // so browsers don't block it as a popup; loadXML() will
                // navigate this tab to the viewer once the file is read.
                const newTab = window.open('about:blank', '_blank');
                loadXML(newTab);
            } else {
                try { inp.click(); statusEl && (statusEl.textContent = 'Please select an XML file'); } catch (err) { logError('Failed to open file picker: ' + String(err)); }
            }
        });
        logDebug('Upload button wired');
        if (statusEl) statusEl.textContent = 'Upload button wired';
    } else {
        logWarn('Upload button not found at DOMContentLoaded');
        if (statusEl) statusEl.textContent = 'Upload button not found';
    }
    const fileInput = document.getElementById('xmlFile');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            logDebug('file input change event, files: ' + (e.target.files && e.target.files.length));
            if (statusEl) statusEl.textContent = `Selected ${e.target.files && e.target.files[0] && e.target.files[0].name || ''}`;
            const nameEl = document.getElementById('fileName');
            if (nameEl) nameEl.textContent = (e.target.files && e.target.files[0] && e.target.files[0].name) || 'No file chosen';
            // Note: no auto-load here anymore — loading now happens only
            // when the user clicks "Upload XML", since that click is what
            // opens the new tab (needed to avoid popup blockers).
        });
    }

    document.body.addEventListener('click', (event) => {
        const citation = event.target.closest && event.target.closest('a.xml-citation');
        if (!citation) return;
        event.preventDefault();
        const rid = citation.dataset.rid || citation.getAttribute('data-rid') || citation.textContent.trim();
        showCitationPopup(rid);
        if (!rid) return;
        const target = document.getElementById(rid) || document.querySelector(`[id="${CSS.escape(rid)}"]`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
});

// Safety: try to attach after a short delay in case script executed before HTML insertion
setTimeout(() => {
    const btn = document.getElementById('uploadBtn');
    if (btn && !btn.dataset.__wired) {
        btn.addEventListener('click', () => {
            const inp = document.getElementById('xmlFile');
            if (inp && inp.files && inp.files.length) {
                const newTab = window.open('about:blank', '_blank');
                loadXML(newTab);
            }
        });
        btn.dataset.__wired = '1';
        logDebug('Upload button wired (delayed attach)');
        const statusElDelayed = document.getElementById('uploadStatus');
        if (statusElDelayed) statusElDelayed.textContent = 'Upload button wired (delayed attach)';
    }
}, 250);

function showCitationPopup(text) {
    const popup = document.getElementById('citationPopup');
    if (!popup) return;
    popup.textContent = text;
    popup.classList.add('visible');
    clearTimeout(window.citationPopupTimeout);
    window.citationPopupTimeout = setTimeout(() => {
        popup.classList.remove('visible');
    }, 2000);
}

function getLocalName(node) {
    return (node && (node.localName || node.nodeName) || '').toLowerCase();
}

function findFirstElement(root, names) {
    if (!root) return null;
    if (names.includes(getLocalName(root))) return root;
    const elems = root.getElementsByTagName('*');
    for (const child of elems) {
        if (names.includes(getLocalName(child))) return child;
    }
    return null;
}

function findAllElements(root, names) {
    if (!root) return [];
    return Array.from(root.getElementsByTagName('*')).filter(node => names.includes(getLocalName(node)));
}

function collectChildElements(root, names) {
    return Array.from(root.childNodes).filter(node => node.nodeType === Node.ELEMENT_NODE && names.includes(getLocalName(node)));
}

function getText(node) {
    if (!node) return '';
    let text = '';
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.nodeValue.replace(/\s+/g, ' ');
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            text += getText(child);
        }
    }
    return text.trim().replace(/\s+/g, ' ');
}

function renderArticle(article) {
    const front = findFirstElement(article, ['front']) || article;
    const body = findFirstElement(article, ['body']);
    const back = findFirstElement(article, ['back']);

    const frontHtml = renderFront(front);
    const bodyHtml = renderBody(body);
    const referenceHtml = renderReferences(back);
    const notesHtml = renderNotes(back);

    return `<article class="article-card">${frontHtml}${bodyHtml}${notesHtml}${referenceHtml}</article>`;
}

function renderFront(front) {
    const title = getText(findFirstElement(front, ['article-title', 'title']));
    const authorHtml = renderAuthors(front);
    const affiliationHtml = renderAffiliations(front);
    const correspondentHtml = renderCorrespondingAuthors(front);
    const abstractHtml = renderAbstract(front);
    const keywordsHtml = renderKeywords(front);

    return `<header class="article-header">
        ${title ? `<h1 class="article-title">${escapeHtml(title)}</h1>` : ''}
        ${authorHtml}
        ${affiliationHtml}
        ${correspondentHtml}
        ${abstractHtml}
        ${keywordsHtml}
    </header>`;
}

function renderAuthors(front) {
    const contribs = findAllElements(front, ['contrib']).filter(contrib => {
        const type = contrib.getAttribute('contrib-type');
        return !type || type.toLowerCase() === 'author';
    });
    const names = contribs.map(contrib => renderAuthorContrib(contrib)).filter(Boolean);

    if (!names.length) return '';
    return `<div class="article-authors">${names.join(', ')}</div>`;
}

function renderAuthorContrib(contrib) {
    const nameHtml = renderAuthorName(contrib);
    const children = Array.from(contrib.childNodes).filter(node => node.nodeType === Node.ELEMENT_NODE);

    // Collect each citation type into its own bucket so we can output them
    // in a fixed order (matching the source document), regardless of the
    // order the XML elements actually appear in:
    //   1. Affiliation  2. Corresponding author  3. Notes
    //   4. PARAGON-PLUS  5. ORCID  6. anything else
    const buckets = { aff: [], corresp: [], notes: [], paragonPlus: [], orcid: [], other: [] };

    for (const child of children) {
        const tag = getLocalName(child);

        if (tag === 'xref') {
            const rid = child.getAttribute('rid') || child.getAttribute('ref') || child.getAttribute('xlink:href') || '';
            const refType = (child.getAttribute('ref-type') || '').toLowerCase();
            const html = renderAuthorXref(child, contrib);
            if (!html) continue;
            if (refType === 'aff' || /^aff/i.test(rid)) buckets.aff.push(html);
            else if (refType === 'corresp' || /^cor/i.test(rid)) buckets.corresp.push(html);
            else if (refType === 'author-notes' || /^notes/i.test(rid)) buckets.notes.push(html);
            else buckets.other.push(html);
        } else if (tag === 'contrib-id') {
            const type = (child.getAttribute('contrib-id-type') || child.getAttribute('id-type') || '').toLowerCase();
            const html = renderContribId(child);
            if (!html) continue;
            if (type === 'paragon-plus' || type === 'paragon_plus') buckets.paragonPlus.push(html);
            else if (type === 'orcid') buckets.orcid.push(html);
            else buckets.other.push(html);
        } else if (tag === 'contrib-meta') {
            collectChildElements(child, ['external-id', 'contrib-id']).forEach(metaChild => {
                const metaTag = getLocalName(metaChild);
                let html, type;
                if (metaTag === 'contrib-id') {
                    type = (metaChild.getAttribute('contrib-id-type') || metaChild.getAttribute('id-type') || '').toLowerCase();
                    html = renderContribId(metaChild);
                } else {
                    type = (metaChild.getAttribute('id_type') || metaChild.getAttribute('id-type') || metaChild.getAttribute('external-id-type') || '').toLowerCase();
                    const value = metaChild.getAttribute('id_value') || metaChild.getAttribute('id-value') || getText(metaChild);
                    if (!value) return;
                    const label = formatExternalIdLabel(type) || 'ID';
                    html = `<sup><a href="#" class="xml-citation" data-rid="${escapeHtml(value)}"><span class="author-id" style="${CAPTION_LABEL_BOX_STYLE} padding:0 3px; font-size:0.75em;">${escapeHtml(label)}</span></a></sup>`;
                }
                if (!html) return;
                if (type === 'paragon-plus' || type === 'paragon_plus') buckets.paragonPlus.push(html);
                else if (type === 'orcid') buckets.orcid.push(html);
                else buckets.other.push(html);
            });
        }
    }

    const orderedParts = [
        ...buckets.aff,
        ...buckets.corresp,
        ...buckets.notes,
        ...buckets.paragonPlus,
        ...buckets.orcid,
        ...buckets.other
    ];

    const content = `${nameHtml}${orderedParts.join('')}`;
    return content || renderInlineNodes(contrib);
}

function renderAuthorName(contrib) {
    const collab = findFirstElement(contrib, ['collab']);
    if (collab) return renderInlineNodes(collab);

    const name = findFirstElement(contrib, ['name']);
    if (!name) return '';

    const surname = getText(findFirstElement(name, ['surname']));
    const given = getText(findFirstElement(name, ['given-names']));
    const suffix = getText(findFirstElement(name, ['suffix']));
    return escapeHtml([given, surname, suffix].filter(Boolean).join(' '));
}

function renderAuthorXref(xref, contrib) {
    const rid = xref.getAttribute('rid') || xref.getAttribute('ref') || xref.getAttribute('xlink:href') || '';
    const refType = (xref.getAttribute('ref-type') || '').toLowerCase();
    const isSupRef = refType === 'aff' || refType === 'corresp' || refType === 'author-notes' || /^aff/i.test(rid) || /^cor/i.test(rid) || /^notes/i.test(rid);
    let display = getText(xref);

    if (!display && (refType === 'aff' || /^aff/i.test(rid))) {
        display = getLabelByRid(contrib.ownerDocument, rid, ['aff']);
    } else if (!display && (refType === 'corresp' || /^cor/i.test(rid))) {
        display = getLabelByRid(contrib.ownerDocument, rid, ['corresp']);
    } else if (!display && (refType === 'author-notes' || /^notes/i.test(rid))) {
        display = getLabelByRid(contrib.ownerDocument, rid, ['fn', 'notes', 'author-notes']);
    }

    if (!display && rid && /^https?:\/\//i.test(rid)) {
        display = rid;
    }

    if (!display) return '';
    if (isSupRef) return `<sup><a href="#" class="xml-citation" data-rid="${escapeHtml(rid)}"><span class="author-ref-label" style="${CAPTION_LABEL_BOX_STYLE} padding:0 3px; font-size:0.75em;">${escapeHtml(display)}</span></a></sup>`;
    if (rid && /^https?:\/\//i.test(rid)) {
        return `<a href="${escapeHtml(rid)}" target="_blank" rel="noopener noreferrer">${escapeHtml(display)}</a>`;
    }

    return `<a href="#" class="xml-citation" data-rid="${escapeHtml(rid || display)}">${escapeHtml(display)}</a>`;
}

function renderContribId(contribId) {
    const value = getText(contribId);
    if (!value) return '';
    const type = contribId.getAttribute('contrib-id-type') || contribId.getAttribute('id-type') || '';
    const label = formatExternalIdLabel(type) || 'ID';
    // Show only the short type label (e.g. "PARAGON-PLUS", "ORCID") as a
    // clickable boxed link; clicking shows the actual ID value in the
    // citation popup instead of printing "TYPE = value" inline.
    return `<sup><a href="#" class="xml-citation" data-rid="${escapeHtml(value)}"><span class="author-id" style="${CAPTION_LABEL_BOX_STYLE} padding:0 3px; font-size:0.75em;">${escapeHtml(label)}</span></a></sup>`;
}

function renderContribMeta(contribMeta) {
    return collectChildElements(contribMeta, ['external-id', 'contrib-id'])
        .map(child => {
            const tag = getLocalName(child);
            if (tag === 'contrib-id') return renderContribId(child);

            const value = child.getAttribute('id_value') || child.getAttribute('id-value') || getText(child);
            if (!value) return '';
            const type = child.getAttribute('id_type') || child.getAttribute('id-type') || child.getAttribute('external-id-type') || '';
            const label = formatExternalIdLabel(type) || 'ID';
            return `<sup><a href="#" class="xml-citation" data-rid="${escapeHtml(value)}"><span class="author-id" style="${CAPTION_LABEL_BOX_STYLE} padding:0 3px; font-size:0.75em;">${escapeHtml(label)}</span></a></sup>`;
        })
        .filter(Boolean)
        .join('');
}

function formatExternalIdLabel(type) {
    const normalized = (type || '').toLowerCase();
    if (normalized === 'paragon-plus' || normalized === 'paragon_plus') return 'PARAGON-PLUS';
    if (normalized === 'orcid') return 'ORCID';
    return type;
}

function getLabelByRid(root, rid, names) {
    if (!root || !rid) return '';
    const nodes = findAllElements(root, names);
    const target = nodes.find(node => (node.getAttribute('id') || node.getAttribute('xml:id')) === rid);
    return target ? getText(findFirstElement(target, ['label'])) : '';
}

function renderAffiliations(front) {
    const affs = findAllElements(front, ['aff']);
    if (!affs.length) return '';
    const items = affs.map(aff => {
        const label = getText(findFirstElement(aff, ['label']));
        const institution = getText(findFirstElement(aff, ['institution', 'institution-wrap']));
        const addrLines = findAllElements(aff, ['addr-line']).map(getText).filter(Boolean).join(', ');
        const country = getText(findFirstElement(aff, ['country']));
        const details = [institution, addrLines, country].filter(Boolean).join(', ');
        return `<div class="article-affiliation">${label ? `<span class="aff-label" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(label)}</span> ` : ''}${escapeHtml(details)}</div>`;
    });
    return `<div class="article-affiliations">${items.join('')}</div>`;
}

// Renders a node's inline content the same way renderInlineNodes() does,
// but skips its <label> child (if any) — used when the label is being
// rendered separately as its own boxed span, so it isn't printed twice.
function renderInlineNodesWithoutLabel(node) {
    const labelNode = findFirstElement(node, ['label']);
    if (!labelNode) return renderInlineNodes(node);
    const clone = node.cloneNode(true);
    const cloneLabel = findFirstElement(clone, ['label']);
    if (cloneLabel && cloneLabel.parentNode) cloneLabel.parentNode.removeChild(cloneLabel);
    return renderInlineNodes(clone);
}

// Corresponding-author markers aren't always wrapped in an explicit <label>
// element — sometimes the marker (*, †, ‡, §, ¶, or a bare number) is just
// plain leading text inside <corresp>. This extracts that marker either way:
//   - if a real <label> child exists, use it (and remove it from the clone)
//   - otherwise, look for a leading symbol/number in the first text node
//     and strip just that from the clone, so it isn't duplicated below.
function extractCorrespLabel(corresp) {
    const explicitLabel = findFirstElement(corresp, ['label']);
    if (explicitLabel) {
        const label = getText(explicitLabel);
        const clone = corresp.cloneNode(true);
        const cloneLabel = findFirstElement(clone, ['label']);
        if (cloneLabel && cloneLabel.parentNode) cloneLabel.parentNode.removeChild(cloneLabel);
        return { label, cleanNode: clone };
    }

    const clone = corresp.cloneNode(true);
    for (const child of Array.from(clone.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const match = child.nodeValue.match(/^(\s*)([*†‡§¶#]+|\d+)(\s*)/);
            if (match && match[2]) {
                child.nodeValue = child.nodeValue.slice(match[0].length);
                return { label: match[2], cleanNode: clone };
            }
            if (child.nodeValue.trim()) break; // real text with no leading symbol
            continue;
        }
        break; // hit an element before finding any leading text — stop looking
    }
    return { label: '', cleanNode: corresp };
}

function renderCorrespondingAuthors(front) {
    const correspondences = findAllElements(front, ['corresp']);
    if (!correspondences.length) return '';
    const items = correspondences.map(corresp => {
        const { label, cleanNode } = extractCorrespLabel(corresp);
        const rest = renderInlineNodes(cleanNode);
        return `<div>${label ? `<span class="corresp-label" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(label)}</span> ` : ''}${rest}</div>`;
    }).join('');
    return `<div class="article-corresponding"><strong>Corresponding author:</strong> ${items}</div>`;
}

function renderAbstract(front) {
    const abstracts = findAllElements(front, ['abstract']);
    if (!abstracts.length) return '';
    const blocks = abstracts.map(abs => {
        const title = getText(findFirstElement(abs, ['title']));
        const paragraphs = collectChildElements(abs, ['p']).map(renderParagraph).join('');
        return `
            ${title ? `<h2 class="section-heading">${escapeHtml(title)}</h2>` : ''}
            ${paragraphs}
        `;
    }).join('');
    return `<section class="article-abstract"><h2 class="section-heading">Abstract</h2>${blocks}</section>`;
}

function renderKeywords(front) {
    const kwdGroups = findAllElements(front, ['kwd-group']);
    if (!kwdGroups.length) return '';
    const lines = kwdGroups.map(group => {
        const label = getText(findFirstElement(group, ['title'])) || 'Keywords';
        const keywords = findAllElements(group, ['kwd']).map(getText).filter(Boolean);
        if (!keywords.length) return '';
        return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(keywords.join(', '))}</p>`;
    }).join('');

    return lines ? `<div class="article-keywords">${lines}</div>` : '';
}

function renderBody(body) {
    if (!body) return '';
    const children = Array.from(body.childNodes).filter(node => node.nodeType === Node.ELEMENT_NODE);
    const figureCaptions = window.__allFigureCaptionKeys || getFigureCaptionKeys(children);
    const html = children.map((child, index) => {
        const tag = getLocalName(child);
        const next = children[index + 1];
        if (tag === 'p' && isDuplicateCaptionParagraph(child, next, figureCaptions)) {
            return '';
        }
        if (tag === 'sec') return renderSection(child, 2);
        if (tag === 'p') return renderParagraph(child);
        if (tag === 'fig') return renderFigure(child);
        if (tag === 'table' || tag === 'table-wrap') return renderTable(child);
        if (tag === 'disp-formula') return renderMath(child, true);
        if (tag === 'boxed-text') return renderBoxedText(child);
        return '';
    }).join('');

    return html ? `<section class="article-body">${html}</section>` : '';
}

function renderSection(section, level) {
    const heading = getText(findFirstElement(section, ['title']));
    const headerTag = level <= 3 ? `h${level}` : 'h4';
    const children = Array.from(section.childNodes).filter(node => node.nodeType === Node.ELEMENT_NODE && getLocalName(node) !== 'title');
    const figureCaptions = window.__allFigureCaptionKeys || getFigureCaptionKeys(children);
    const content = children.map((child, index) => {
        const tag = getLocalName(child);
        const next = children[index + 1];
        if (tag === 'p' && isDuplicateCaptionParagraph(child, next, figureCaptions)) {
            return '';
        }
        if (tag === 'sec') return renderSection(child, level + 1);
        if (tag === 'p') return renderParagraph(child);
        if (tag === 'fig') return renderFigure(child);
        if (tag === 'table' || tag === 'table-wrap') return renderTable(child);
        if (tag === 'disp-formula') return renderMath(child, true);
        if (tag === 'list') return renderList(child);
        if (tag === 'boxed-text') return renderBoxedText(child);
        return '';
    }).join('');

    return `<section class="article-section">${heading ? `<${headerTag}>${escapeHtml(heading)}</${headerTag}>` : ''}${content}</section>`;
}

function renderParagraph(node) {
    const content = renderInlineNodes(node);
    if (!content.trim()) return '';
    return `<p>${content}</p>`;
}

// Returns the next sequential number for a given label word (Figure, Table,
// Scheme, Chart, Plate, ...), incrementing a per-document-load counter.
// This ignores whatever <label> value is in the XML and guarantees a clean
// sequence like Figure 1, Figure 2, Figure 3 in document order.
function nextTypeLabel(type) {
    if (!window.__typeCounters) window.__typeCounters = {};
    window.__typeCounters[type] = (window.__typeCounters[type] || 0) + 1;
    return `${type} ${window.__typeCounters[type]}`;
}

// Decides which left-panel row tag and which label word a figure-like
// element should use:
//   fig (default)              -> rowTag 'figurecaption', label word 'Figure'
//   fig[fig-type="chart"]/chart -> rowTag 'figurecaption', label word 'Chart'
//   fig[fig-type="plate"]/plate -> rowTag 'figurecaption', label word 'Plate'
//   scheme / scheme-wrap        -> rowTag 'schemecaption', label word 'Scheme'
//   table / table-wrap          -> rowTag 'tablecaption',  label word 'Table'
function classifyObjectNode(node) {
    const tag = getLocalName(node);
    const figType = ((node.getAttribute && (node.getAttribute('fig-type') || node.getAttribute('content-type'))) || '').toLowerCase();

    if (tag === 'table' || tag === 'table-wrap') {
        return { rowTag: 'tablecaption', type: 'Table' };
    }
    if (tag === 'scheme' || tag === 'scheme-wrap' || figType === 'scheme') {
        return { rowTag: 'schemecaption', type: 'Scheme' };
    }
    if (tag === 'chart' || tag === 'chart-wrap' || figType === 'chart') {
        return { rowTag: 'figurecaption', type: 'Chart' };
    }
    if (tag === 'plate' || tag === 'plate-wrap' || figType === 'plate') {
        return { rowTag: 'figurecaption', type: 'Plate' };
    }
    return { rowTag: 'figurecaption', type: 'Figure' };
}

// Strips a leading "Figure 1", "Fig. 1", "Chart 1", "Plate 1", "Table 1",
// "Scheme 1" (with optional punctuation) from raw (non-lowercased) caption
// text, so we don't end up with the XML's own label duplicated next to our
// sequential one.
function stripLeadingLabelPrefix(text) {
    return (text || '').replace(/^\s*(figure|fig\.?|chart|plate|table|scheme)\s*\d+\s*[:.\-]?\s*/i, '');
}

// Generalized renderer for figure-like objects (Figure, Chart, Plate,
// Scheme) — an image/graphic plus a caption, labeled with a clean
// sequential number ("Figure 1.", "Chart 1.", "Plate 1.", "Scheme 1.").
function renderFigureLike(node, labelWord) {
    const captionNode = findFirstElement(node, ['caption']);
    let captionText = captionNode ? getText(captionNode) : '';
    captionText = stripLeadingLabelPrefix(captionText);

    const sequentialLabel = nextTypeLabel(labelWord); // e.g. "Figure 1"

    const graphic = findFirstElement(node, ['graphic']);
    let imageHtml = '';
    if (graphic) {
        const href = graphic.getAttribute('href') || graphic.getAttribute('xlink:href');
        if (href) {
            const src = resolveImagePath(href);
            // If the image fails to load, replace it with a clean placeholder
            // instead of letting the browser fall back to showing the raw
            // alt text inline (which looked like a duplicated caption).
            imageHtml = `<img src="${escapeHtml(src)}" alt="${escapeHtml(labelWord)} image" onerror="this.onerror=null; this.outerHTML='<div style=&quot;padding:36px 0; color:#64748b; font-size:0.98rem;&quot;>[${escapeHtml(labelWord)} image not available]</div>';">`;
        }
    }
    if (!imageHtml) {
        imageHtml = `<div style="padding:36px 0; color:#64748b; font-size:0.98rem;">[${escapeHtml(labelWord)} content]</div>`;
    }

    // "Table 4 . Mean sensitivities..." — the label word+number gets a
    // bordered "box" around it (matching the source document's field-style
    // boxed label), the period and rest of the caption follow normally.
    const captionHtml = `<div class="figure-caption"><span class="caption-label-box" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(sequentialLabel)}</span>.${captionText ? ' ' + escapeHtml(captionText) : ''}</div>`;

    return `<figure class="article-figure">${imageHtml}${captionHtml}</figure>`;
}

// Backward-compatible wrapper: plain <fig> elements default to "Figure".
function renderFigure(node) {
    const classification = classifyObjectNode(node);
    return renderFigureLike(node, classification.type);
}



function normalizeComparableText(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        // strip leading "Figure 1", "Fig. 1", "Chart 1", "Table 1", "Scheme 1" etc,
        // with or without punctuation, so duplicates using different label words
        // (e.g. caption text starting with "Chart 1..." vs label "Figure 1") still match.
        .replace(/^(figure|fig\.?|chart|table|scheme)\s*\d+\s*[:.\-]?\s*/i, '')
        .replace(/[\s.,;:]+$/g, '')
        .trim()
        .toLowerCase();
}

function textMatchesFigureCaption(paragraphKey, captionKey) {
    if (!paragraphKey || !captionKey) return false;
    if (paragraphKey === captionKey) return true;

    // Some XML suppliers add the figure number to one copy of the caption,
    // or duplicate the caption as a standalone paragraph elsewhere in the body.
    // Treat it as a duplicate if either text fully contains the other.
    const shorter = paragraphKey.length <= captionKey.length ? paragraphKey : captionKey;
    const longer = paragraphKey.length <= captionKey.length ? captionKey : paragraphKey;
    if (shorter.length >= 20 && longer.includes(shorter)) return true;

    // Fallback: high word-overlap similarity (handles minor rewordings/typos)
    const wordsA = new Set(shorter.split(' ').filter(Boolean));
    const wordsB = new Set(longer.split(' ').filter(Boolean));
    if (wordsA.size === 0) return false;
    let overlap = 0;
    wordsA.forEach(w => { if (wordsB.has(w)) overlap++; });
    return overlap / wordsA.size >= 0.85;
}

function getFigureCaptionKeys(nodes) {
    return new Set(
        nodes
            .filter(node => getLocalName(node) === 'fig')
            .map(node => findFirstElement(node, ['caption']))
            .map(getText)
            .map(normalizeComparableText)
            .filter(Boolean)
    );
}

// Document-wide version of getFigureCaptionKeys: collects the caption of every
// <fig> anywhere in the document (not just a set of siblings), so a duplicate
// paragraph is caught regardless of which section/nesting level it or its
// matching <fig> live in.
function getAllFigureCaptionKeys(root) {
    return new Set(
        findAllElements(root, ['fig'])
            .map(node => findFirstElement(node, ['caption']))
            .map(getText)
            .map(normalizeComparableText)
            .filter(Boolean)
    );
}

function isDuplicateCaptionParagraph(pNode, adjacentNode, figureCaptionKeys) {
    // Case A: paragraph contains only an image/graphic (no real text) that
    // duplicates a figure elsewhere — e.g. a stray <graphic>/<img>-only <p>.
    const hasOnlyGraphic = !!findFirstElement(pNode, ['graphic', 'inline-graphic'])
        && getText(pNode).trim().length === 0;
    if (hasOnlyGraphic) return true;

    const paragraphKey = normalizeComparableText(getText(pNode));
    if (!paragraphKey) return false;

    // Compare against every figure caption in the document (global set),
    // not just the immediately adjacent node or local siblings.
    if (figureCaptionKeys && Array.from(figureCaptionKeys).some(captionKey => textMatchesFigureCaption(paragraphKey, captionKey))) {
        return true;
    }

    if (!adjacentNode || getLocalName(adjacentNode) !== 'fig') return false;
    const captionNode = findFirstElement(adjacentNode, ['caption']);
    return captionNode && textMatchesFigureCaption(paragraphKey, normalizeComparableText(getText(captionNode)));
}

function renderList(node) {
    const type = node.getAttribute('list-type');
    const items = findAllElements(node, ['list-item']).map(item => {
        const content = collectChildElements(item, ['p']).map(renderParagraph).join('') || renderInlineNodes(item);
        return `<li>${content}</li>`;
    }).join('');
    if (!items) return '';
    const tag = type === 'bullet' ? 'ul' : 'ol';
    return `<div class="article-list"><${tag}>${items}</${tag}></div>`;
}

function renderBoxedText(node) {
    const title = getText(findFirstElement(node, ['title']));
    const paragraphs = collectChildElements(node, ['p']).map(renderParagraph).join('');
    return `<div class="article-boxed-text">${title ? `<h4>${escapeHtml(title)}</h4>` : ''}${paragraphs}</div>`;
}

function renderMath(node, block) {
    const formula = findFirstElement(node, ['inline-formula', 'mml:math', 'math']);
    const mathContent = formula ? serializeNode(formula) : escapeHtml(getText(node));
    if (block) {
        return `<div class="math-block">${mathContent}</div>`;
    }
    return `<span class="math-inline">${mathContent}</span>`;
}

function serializeNode(node) {
    try {
        return new XMLSerializer().serializeToString(node);
    } catch (error) {
        return escapeHtml(getText(node));
    }
}

function renderTable(node) {
    const tag = getLocalName(node);
    if (tag === 'table') {
        // Plain <table> (no wrapper/caption) — still give it a sequential
        // "Table N." caption line above it for consistency.
        const sequentialLabel = nextTypeLabel('Table');
        return `
        <div class="xml-table-wrap">
            <div class="xml-table-caption"><span class="caption-label-box" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(sequentialLabel)}</span>.</div>
            ${node.outerHTML}
        </div>
    `;
    }

    // Support JATS/table-wrap structure
    const captionNode = findFirstElement(node, ['caption']);
    let captionText = captionNode ? getText(captionNode) : '';
    captionText = stripLeadingLabelPrefix(captionText);
    const sequentialLabel = nextTypeLabel('Table'); // e.g. "Table 1"

    const tgroup = findFirstElement(node, ['tgroup']) || findFirstElement(node, ['table']);
    const rows = [];
    if (tgroup) {
        const rowElements = findAllElements(tgroup, ['row']);
        for (const row of rowElements) {
            const entries = findAllElements(row, ['entry']).map(entry => `<td>${renderInlineNodes(entry)}</td>`).join('');
            rows.push(`<tr>${entries}</tr>`);
        }
    }
    const tableHtml = rows.length ? `<table class="xml-table">${rows.join('')}</table>` : '<div class="xml-table-placeholder">[Table content]</div>';
    return `
        <div class="xml-table-wrap">
            <div class="xml-table-caption"><span class="caption-label-box" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(sequentialLabel)}</span>.${captionText ? ' ' + escapeHtml(captionText) : ''}</div>
            ${tableHtml}
        </div>
    `;
}

function renderReferences(back) {
    if (!back) return '';
    const refList = findFirstElement(back, ['ref-list', 'citation-list']);
    if (!refList) return '';
    const refs = collectChildElements(refList, ['ref']);
    if (!refs.length) return '';
    const items = refs.map((ref, index) => renderReferenceItem(ref, index + 1)).join('');
    return `<section class="article-references"><h2 class="section-heading">References</h2><ul style="list-style:none; padding-left:0;">${items}</ul></section>`;
}

function renderReferenceItem(ref, index) {
    const citation = findFirstElement(ref, ['mixed-citation', 'element-citation']);
    const text = citation ? getText(citation) : getText(ref);
    const rid = ref.getAttribute('id') || `ref-${index}`;
    return `<li id="${escapeHtml(rid)}"><span class="ref-number-box" style="${CAPTION_LABEL_BOX_STYLE}">${index}</span> ${escapeHtml(text)}</li>`;
}

// Maps a <notes notes-type="..."> / <ack> value to the heading text and
// left-panel row tag that should be shown for it.
function classifyNotesNode(node) {
    const tag = getLocalName(node);
    if (tag === 'ack') {
        return { rowTag: 'ack', heading: 'Acknowledgements' };
    }
    const notesType = (node.getAttribute && node.getAttribute('notes-type') || '').toLowerCase();
    if (notesType === 'si') {
        return { rowTag: 'si', heading: 'Supporting Information' };
    }
    if (notesType === 'data-availability') {
        return { rowTag: 'data-availability', heading: 'Data Availability' };
    }
    if (notesType === 'conflict-of-interest') {
        return { rowTag: 'conflict-of-interest', heading: 'Conflict of Interest' };
    }
    if (notesType) {
        // Fallback: turn "some-type" into "Some Type" for the heading, and
        // keep the raw notes-type as the row tag.
        const heading = notesType.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return { rowTag: notesType, heading };
    }
    return { rowTag: tag, heading: 'Notes' };
}

// Returns one row per <ack>/<notes>/<fn-group>/<footnotes> element found in
// <back>, each labeled with its own notes-type (e.g. "si", "data-availability",
// "conflict-of-interest") instead of a single generic "notes" row that
// repeats "Acknowledgements" as the heading for every one of them.
function renderNotesRows(back) {
    if (!back) return [];
    const notes = findAllElements(back, ['ack', 'notes', 'fn-group', 'footnotes']);
    return notes.map(node => {
        const classification = classifyNotesNode(node);
        const titleFromXml = getText(findFirstElement(node, ['title']));
        const heading = titleFromXml || classification.heading;
        const paragraphs = collectChildElements(node, ['p']).map(renderParagraph).join('') || `<p>${renderInlineNodes(node)}</p>`;
        const content = `<section class="article-notes"><h2 class="section-heading">${escapeHtml(heading)}</h2>${paragraphs}</section>`;
        return { tag: classification.rowTag, content };
    });
}

// Backward-compatible wrapper (kept in case anything still calls renderNotes
// directly and expects a single combined HTML string).
function renderNotes(back) {
    return renderNotesRows(back).map(r => r.content).join('');
}

function renderInlineNodes(node) {
    const parts = [];
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = child.nodeValue.replace(/\s+/g, ' ');
            if (text.trim()) parts.push(escapeHtml(text));
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = getLocalName(child);
        if (tag === 'xref' || tag === 'bibref' || tag === 'bibref-group') {
            parts.push(renderCitation(child));
        } else if (tag === 'italic' || tag === 'i') {
            parts.push(`<em>${renderInlineNodes(child)}</em>`);
        } else if (tag === 'bold' || tag === 'b') {
            parts.push(`<strong>${renderInlineNodes(child)}</strong>`);
        } else if (tag === 'sup') {
            parts.push(`<sup>${renderInlineNodes(child)}</sup>`);
        } else if (tag === 'sub') {
            parts.push(`<sub>${renderInlineNodes(child)}</sub>`);
        } else if (tag === 'underline') {
            parts.push(`<u>${renderInlineNodes(child)}</u>`);
        } else if (tag === 'inline-formula') {
            parts.push(renderMath(child, false));
        } else if (tag === 'ext-link' || tag === 'a') {
            const href = child.getAttribute('href') || child.getAttribute('xlink:href') || '#';
            parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${renderInlineNodes(child)}</a>`);
        } else {
            parts.push(renderInlineNodes(child));
        }
    }
    return parts.join('');
}

// Maps a ref-type / rid-prefix to the display label word for a citation.
const REF_TYPE_TO_OBJECT_TYPE = {
    fig: 'Figure', figure: 'Figure',
    table: 'Table', tbl: 'Table', tab: 'Table',
    chart: 'Chart',
    scheme: 'Scheme',
    plate: 'Plate'
};

// Maps the display label word back to the key used in window.__objectLabelIndex
// (built by buildObjectLabelIndex) so we can look up a real label if one exists.
const OBJECT_TYPE_TO_INDEX_KEY = {
    Figure: 'fig',
    Table: 'table',
    Chart: 'chart',
    Scheme: 'scheme',
    Plate: 'plate'
};

// Determines whether an xref points at a Figure/Table/Chart/Scheme/Plate,
// checking the explicit ref-type attribute first, then falling back to the
// rid's own prefix (e.g. "figS14" -> Figure, "tblS2" -> Table).
function detectObjectType(rid, refType) {
    const rt = (refType || '').toLowerCase();
    if (REF_TYPE_TO_OBJECT_TYPE[rt]) return REF_TYPE_TO_OBJECT_TYPE[rt];

    const idMatch = (rid || '').match(/^(fig|table|tbl|tab|chart|scheme|plate)/i);
    if (idMatch) {
        return REF_TYPE_TO_OBJECT_TYPE[idMatch[1].toLowerCase()] || null;
    }
    return null;
}

function renderCitation(node) {
    let display = getText(node) || '';
    const rid = node.getAttribute('rid') || node.getAttribute('ref') || node.getAttribute('xlink:href') || display;
    const refType = (node.getAttribute('ref-type') || '').toLowerCase();
    const objectType = detectObjectType(rid, refType);

    if (getLocalName(node) === 'xref' && (refType === 'aff' || refType === 'corresp')) {
        return `<sup><a href="#" class="xml-citation" data-rid="${escapeHtml(rid)}"><span class="author-ref-label" style="${CAPTION_LABEL_BOX_STYLE} padding:0 3px; font-size:0.75em;">${escapeHtml(display)}</span></a></sup>`;
    }

    if (objectType) {
        // Supporting-information style rids (e.g. "figS14", "tblS2",
        // "schemeS3") carry their number after an "S" at the end of the id.
        // The visible XML text is often just "Figure S" (the number lives
        // only in the id, via a malformed/empty nested xref), so we must
        // pull the number from the rid itself rather than trust display text.
        const supMatch = (rid || '').match(/S(\d+)$/i);
        const indexKey = OBJECT_TYPE_TO_INDEX_KEY[objectType];
        const existingLabel = getObjectLabelByRid(rid, indexKey);

        let finalLabel;
        if (supMatch) {
            finalLabel = `${objectType} S${supMatch[1]}`;
        } else if (existingLabel) {
            finalLabel = `${objectType} ${existingLabel}`;
        } else {
            const digitMatch = (rid || '').match(/(\d+)$/);
            finalLabel = digitMatch ? `${objectType} ${digitMatch[1]}` : (display || objectType);
        }

        return `<a href="#" class="xml-citation" data-rid="${escapeHtml(rid)}">${escapeHtml(finalLabel)}</a>`;
    }

    if (getLocalName(node) === 'xref' && refType === 'bibr') {
        // Prefer numeric label from built index; fall back to digits extracted from rid or display
        let num = null;
        try {
            if (window.__refIndex && window.__refIndex[rid]) num = window.__refIndex[rid];
        } catch (e) {}
        if (!num) {
            const m = (rid || display || '').toString().match(/(\d+)/);
            if (m) num = m[1];
        }
        const label = num ? String(num) : '';
        return `<a href="#" class="xml-citation xml-citation-bibr" data-rid="${escapeHtml(rid)}">${escapeHtml(label)}</a>`;
    }

    return `<a href="#" class="xml-citation" data-rid="${escapeHtml(rid)}">${escapeHtml(display)}</a>`;
}

function getObjectLabelByRid(rid, type) {
    try {
        if (window.__objectLabelIndex && window.__objectLabelIndex[type] && window.__objectLabelIndex[type][rid]) {
            return window.__objectLabelIndex[type][rid];
        }
    } catch (e) {}
    return null;
}

function mapSectionLabelFromId(id) {
    if (!id) return 'section';
    const parts = id.replace(/^sec\.?/i, '').split('.').filter(Boolean);
    if (parts.length === 0) return 'section';
    const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    const index = Math.min(parts.length - 1, letters.length - 1);
    return `section${letters[index]}`;
}

function gatherRowsFromNode(node, rows, depth = 0) {
    const children = Array.from(node.childNodes).filter(child => child.nodeType === Node.ELEMENT_NODE);
    const figureCaptions = window.__allFigureCaptionKeys || getFigureCaptionKeys(children);
    for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = getLocalName(child);
        if (tag === 'p' && isDuplicateCaptionParagraph(child, children[index + 1], figureCaptions)) {
            continue;
        }
        if (tag === 'sec') {
            // Push the section heading as its own row at the correct nesting
            // depth (sectiona = depth 1, sectionb = depth 2, ... sectionh = depth 8),
            // then recurse into the section's own children at depth + 1 so that
            // nested <sec> elements get their own correctly-leveled rows instead
            // of being flattened into one HTML blob by renderSection().
            const heading = getText(findFirstElement(child, ['title']));
            const headerLevel = Math.min(depth + 2, 6);
            rows.push({
                tag: mapSectionLabelFromNode(child, depth + 1),
                content: heading ? `<h${headerLevel} class="section-heading-inline">${escapeHtml(heading)}</h${headerLevel}>` : ''
            });
            gatherRowsFromNode(child, rows, depth + 1);
        } else if (tag === 'p') {
            rows.push({ tag: 'Paragraph', content: renderParagraph(child) });
        } else if (tag === 'fig' || tag === 'chart' || tag === 'chart-wrap' || tag === 'plate' || tag === 'plate-wrap') {
            // Figure-like objects: default <fig> -> "Figure", <fig fig-type="chart">
            // or <chart>/<chart-wrap> -> "Chart", <fig fig-type="plate"> or
            // <plate>/<plate-wrap> -> "Plate". All shown under the left-panel
            // tag "figurecaption", with a clean sequential number.
            const classification = classifyObjectNode(child);
            rows.push({ tag: classification.rowTag, content: renderFigureLike(child, classification.type) });
        } else if (tag === 'scheme' || tag === 'scheme-wrap') {
            rows.push({ tag: 'schemecaption', content: renderFigureLike(child, 'Scheme') });
        } else if (tag === 'table' || tag === 'table-wrap') {
            rows.push({ tag: 'tablecaption', content: renderTable(child) });
        } else if (tag === 'disp-formula') {
            rows.push({ tag: 'formula', content: renderMath(child, true) });
        } else if (tag === 'boxed-text') {
            rows.push({ tag: 'box', content: renderBoxedText(child) });
        } else if (tag === 'list') {
            rows.push({ tag: 'list', content: renderList(child) });
        } else {
            gatherRowsFromNode(child, rows, depth);
        }
    }
}

function mapSectionLabelFromNode(node, depth) {
    // Support 8 nesting levels: sectiona (level 1) through sectionh (level 8).
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const id = (node && node.getAttribute && node.getAttribute('id')) || '';
    const match = id.match(/^sec\.?(.+)$/i);
    if (match) {
        const parts = match[1].split('.').filter(Boolean);
        if (parts.length > 0) {
            const index = Math.min(parts.length - 1, letters.length - 1);
            return `section${letters[index]}`;
        }
    }
    const index = Math.min(Math.max(depth - 1, 0), letters.length - 1);
    return `section${letters[index]}`;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Two-column renderer: left = tag label, right = rendered content rows
function renderTwoColumnArticle(article) {
    const rows = [];
    const front = findFirstElement(article, ['front']) || article;

    // Title
    const title = getText(findFirstElement(front, ['article-title', 'title']));
    if (title) {
        rows.push({ tag: 'articletitle', content: `<h1 class="article-title">${escapeHtml(title)}</h1>` });
    }

    // Authors
    const authorsHtml = renderAuthors(front);
    if (authorsHtml) rows.push({ tag: 'authors', content: authorsHtml });

    // Affiliations (one row per aff)
    const affs = findAllElements(front, ['aff']);
    for (const aff of affs) {
        const label = getText(findFirstElement(aff, ['label']));
        const institution = getText(findFirstElement(aff, ['institution', 'institution-wrap']));
        const addrLines = findAllElements(aff, ['addr-line']).map(getText).filter(Boolean).join(', ');
        const country = getText(findFirstElement(aff, ['country']));
        const details = [institution, addrLines, country].filter(Boolean).join(', ');
        const left = `affiliation ${escapeHtml(label || '')}`.trim();
        rows.push({ tag: left, content: `<div class="article-affiliation">${label ? `<span class="aff-label" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(label)}</span> ` : ''}${escapeHtml(details)}</div>` });
    }

    // Corresponding authors
    const corrs = findAllElements(front, ['corresp']);
    for (const c of corrs) {
        const { label: corrLabel, cleanNode: corrCleanNode } = extractCorrespLabel(c);
        const corrRest = renderInlineNodes(corrCleanNode);
        rows.push({
            tag: 'correspondingauthor',
            content: `<div>${corrLabel ? `<span class="corresp-label" style="${CAPTION_LABEL_BOX_STYLE}">${escapeHtml(corrLabel)}</span> ` : ''}${corrRest}</div>`
        });
    }

    // Abstract(s)
    const abstracts = findAllElements(front, ['abstract']);
    for (const abs of abstracts) {
        const title = getText(findFirstElement(abs, ['title']));
        const paragraphs = collectChildElements(abs, ['p']).map(renderParagraph).join('');
        const content = `${title ? `<h4 class="xml-section-heading">${escapeHtml(title)}</h4>` : ''}${paragraphs}`;
        rows.push({ tag: 'abstract', content });
    }

    // Keywords
    const kwGroups = findAllElements(front, ['kwd-group']);
    for (const g of kwGroups) {
        const keywords = findAllElements(g, ['kwd']).map(getText).filter(Boolean);
        if (keywords.length) rows.push({ tag: 'keywords', content: `<p>${escapeHtml(keywords.join(', '))}</p>` });
    }

    // Body: collect rows from the body and its nested sections
    const body = findFirstElement(article, ['body']);
    if (body) {
        gatherRowsFromNode(body, rows);
    }

    // Back matter: references/notes
    const back = findFirstElement(article, ['back']);
    if (back) {
        const refs = renderReferences(back);
        if (refs) rows.push({ tag: 'references', content: refs });
        // Each <ack>/<notes notes-type="..."> becomes its own row, tagged
        // with its notes-type (e.g. "si", "data-availability",
        // "conflict-of-interest") instead of one shared "notes" row that
        // repeated "Acknowledgements" as the heading for every entry.
        const notesRows = renderNotesRows(back);
        notesRows.forEach(r => rows.push(r));
    }

    // Build HTML rows
    const html = rows.map(r => `
        <div class="xml-row">
            <div class="xml-tag">${escapeHtml(r.tag)}</div>
            <div class="xml-value">${r.content}</div>
        </div>
    `).join('');

    return `<div class="xml-browser">${html}</div>`;
}
