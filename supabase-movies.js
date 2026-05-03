/**
 * MyStreamer — Movie Search & Add
 * Search hits the local /search endpoint (in-memory, instant).
 * Add movie hits the local /movies/add endpoint (server proxies to Supabase).
 */

// ── DOM References ────────────────────────────────────────────────────────────
const movieSearchInput  = document.getElementById('movieSearch');
const searchSpinner     = document.getElementById('searchSpinner');
const searchResultsEl   = document.getElementById('searchResults');
const addMovieBtn       = document.getElementById('addMovieBtn');
const addMovieModal     = document.getElementById('addMovieModal');
const modalClose        = document.getElementById('modalClose');
const modalCancelBtn    = document.getElementById('modalCancelBtn');
const modalSaveBtn      = document.getElementById('modalSaveBtn');
const movieTitleInput   = document.getElementById('movieTitle');
const movieLinkInput    = document.getElementById('movieLink');
const modalStatus       = document.getElementById('modalStatus');

// ── Search ────────────────────────────────────────────────────────────────────
let searchDebounce = null;
let currentController = null;  // AbortController for in-flight requests

movieSearchInput.addEventListener('input', () => {
    const query = movieSearchInput.value.trim();

    clearTimeout(searchDebounce);

    if (!query) {
        hideResults();
        return;
    }

    searchDebounce = setTimeout(() => {
        doSearch(query);
    }, 200);
});

// Close results on outside click
document.addEventListener('click', (e) => {
    if (!searchResultsEl.contains(e.target) && e.target !== movieSearchInput) {
        hideResults();
    }
});

// Re-open results when input is focused and already has content
movieSearchInput.addEventListener('focus', () => {
    if (movieSearchInput.value.trim() && searchResultsEl.children.length > 0) {
        searchResultsEl.classList.add('active');
    }
});

// Keyboard nav: Escape closes dropdown
movieSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideResults();
        movieSearchInput.blur();
    }
});

async function doSearch(query) {
    // Cancel any previous in-flight request
    if (currentController) currentController.abort();
    currentController = new AbortController();

    showSpinner();
    try {
        const res = await fetch(
            `/search?q=${encodeURIComponent(query)}&limit=20`,
            { signal: currentController.signal }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Server error ${res.status}`);
        }
        const movies = await res.json();
        renderResults(movies, query);
    } catch (err) {
        if (err.name === 'AbortError') return; // cancelled, ignore
        console.error('Search error:', err);
        renderError(err.message);
    } finally {
        hideSpinner();
        currentController = null;
    }
}

function renderResults(movies, query) {
    if (!Array.isArray(movies) || movies.length === 0) {
        searchResultsEl.innerHTML = `
            <div class="search-no-results">
                No movies found for "<strong>${escapeHtml(query)}</strong>" — try a different title or add it to the library.
            </div>`;
        searchResultsEl.classList.add('active');
        return;
    }

    searchResultsEl.innerHTML = movies.map(movie => `
        <div class="search-result-item" data-link="${escapeAttr(movie.link)}" data-title="${escapeAttr(movie.title)}">
            <div class="search-result-icon">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" fill="currentColor"/>
                </svg>
            </div>
            <div class="search-result-info">
                <div class="search-result-title">${highlightMatch(movie.title, query)}</div>
                <div class="search-result-link">${escapeHtml(movie.link)}</div>
            </div>
            <button class="search-result-play" title="Play now">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" fill="currentColor"/>
                </svg>
            </button>
        </div>
    `).join('');

    // Attach click handlers to whole row
    searchResultsEl.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            playMovie(item.dataset.link, item.dataset.title);
        });
    });

    searchResultsEl.classList.add('active');
}

function renderError(message) {
    searchResultsEl.innerHTML = `
        <div class="search-no-results" style="color: var(--error);">
            ⚠ ${escapeHtml(message || 'Could not connect to library.')}
        </div>`;
    searchResultsEl.classList.add('active');
}

function hideResults() {
    searchResultsEl.classList.remove('active');
}

function showSpinner() {
    searchSpinner.classList.add('active');
}

function hideSpinner() {
    searchSpinner.classList.remove('active');
}

// Highlight matched query tokens in the title
function highlightMatch(title, query) {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    let safe = escapeHtml(title);
    tokens.forEach(token => {
        const regex = new RegExp(`(${escapeRegex(token)})`, 'gi');
        safe = safe.replace(regex, '<mark>$1</mark>');
    });
    return safe;
}

// ── Play ──────────────────────────────────────────────────────────────────────
function playMovie(link, title) {
    hideResults();
    movieSearchInput.value = '';

    const urlInput = document.getElementById('videoUrl');
    urlInput.value = link;

    if (window.streamFlow) {
        window.streamFlow.loadVideo();
    }
}

// ── Add Movie Modal ───────────────────────────────────────────────────────────
addMovieBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalCancelBtn.addEventListener('click', closeModal);

addMovieModal.addEventListener('click', (e) => {
    if (e.target === addMovieModal) closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && addMovieModal.classList.contains('active')) {
        closeModal();
    }
});

modalSaveBtn.addEventListener('click', saveMovie);
movieLinkInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveMovie(); });
movieTitleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') movieLinkInput.focus(); });

function openModal() {
    movieTitleInput.value = '';
    movieLinkInput.value = '';
    clearModalStatus();
    movieTitleInput.classList.remove('error');
    movieLinkInput.classList.remove('error');
    addMovieModal.classList.add('active');
    setTimeout(() => movieTitleInput.focus(), 50);
}

function closeModal() {
    addMovieModal.classList.remove('active');
}

async function saveMovie() {
    const title = movieTitleInput.value.trim();
    const link  = movieLinkInput.value.trim();

    let hasError = false;
    movieTitleInput.classList.remove('error');
    movieLinkInput.classList.remove('error');

    if (!title) { movieTitleInput.classList.add('error'); movieTitleInput.focus(); hasError = true; }
    if (!link)  { movieLinkInput.classList.add('error'); if (!hasError) movieLinkInput.focus(); hasError = true; }
    if (hasError) return;

    try { new URL(link); } catch {
        movieLinkInput.classList.add('error');
        showModalStatus('error', '⚠ Please enter a valid URL (must start with https://)');
        movieLinkInput.focus();
        return;
    }

    modalSaveBtn.disabled = true;
    modalSaveBtn.querySelector('span').textContent = 'Saving…';
    clearModalStatus();

    try {
        const res = await fetch('/movies/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, link })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unknown error');

        showModalStatus('success', `✓ "${title}" added to the library!`);
        movieTitleInput.value = '';
        movieLinkInput.value = '';
        setTimeout(() => closeModal(), 1600);
    } catch (err) {
        console.error('Add movie error:', err);
        showModalStatus('error', `⚠ Failed to save: ${err.message}`);
    } finally {
        modalSaveBtn.disabled = false;
        modalSaveBtn.querySelector('span').textContent = 'Save to Library';
    }
}

function showModalStatus(type, message) {
    modalStatus.className = `modal-status ${type}`;
    modalStatus.textContent = message;
}

function clearModalStatus() {
    modalStatus.className = 'modal-status';
    modalStatus.textContent = '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
