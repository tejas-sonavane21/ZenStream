/**
 * MyStreamer — Supabase Movies Integration
 * Handles: Search movies from DB, Add movies to DB
 */

// ── Supabase Config ──────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://caklaclowgwprjalnywk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNha2xhY2xvd2d3cHJqYWxueXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2NTQsImV4cCI6MjA4NDI1NDY1NH0.zuymyh5-5WcUKSDYs8aMcf98C5UfLHk14KtQ9jSVr3A';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DOM References ────────────────────────────────────────────────────────────
const movieSearchInput  = document.getElementById('movieSearch');
const searchSpinner     = document.getElementById('searchSpinner');
const searchResults     = document.getElementById('searchResults');
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

movieSearchInput.addEventListener('input', () => {
    const query = movieSearchInput.value.trim();

    clearTimeout(searchDebounce);

    if (!query) {
        hideResults();
        return;
    }

    searchDebounce = setTimeout(() => {
        searchMovies(query);
    }, 280);
});

// Close results on outside click
document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== movieSearchInput) {
        hideResults();
    }
});

// Re-open results if there's text and the field is focused
movieSearchInput.addEventListener('focus', () => {
    const query = movieSearchInput.value.trim();
    if (query && searchResults.innerHTML) {
        searchResults.classList.add('active');
    }
});

async function searchMovies(query) {
    showSpinner();
    try {
        const { data, error } = await supabase
            .from('movies')
            .select('id, title, link')
            .ilike('title', `%${query}%`)
            .order('title', { ascending: true })
            .limit(20);

        if (error) throw error;

        renderResults(data || []);
    } catch (err) {
        console.error('Search error:', err);
        renderError();
    } finally {
        hideSpinner();
    }
}

function renderResults(movies) {
    if (movies.length === 0) {
        searchResults.innerHTML = `
            <div class="search-no-results">
                <span>No movies found — try a different title or add it to the library.</span>
            </div>`;
        searchResults.classList.add('active');
        return;
    }

    searchResults.innerHTML = movies.map(movie => `
        <div class="search-result-item" data-link="${escapeAttr(movie.link)}" data-title="${escapeAttr(movie.title)}">
            <div class="search-result-icon">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" fill="currentColor"/>
                </svg>
            </div>
            <div class="search-result-info">
                <div class="search-result-title">${escapeHtml(movie.title)}</div>
                <div class="search-result-link">${escapeHtml(movie.link)}</div>
            </div>
            <button class="search-result-play" title="Play now">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" fill="currentColor"/>
                </svg>
            </button>
        </div>
    `).join('');

    // Attach click handlers
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            playMovie(item.dataset.link, item.dataset.title);
        });
    });

    searchResults.classList.add('active');
}

function renderError() {
    searchResults.innerHTML = `
        <div class="search-no-results" style="color: var(--error);">
            ⚠ Could not connect to the library. Check your connection.
        </div>`;
    searchResults.classList.add('active');
}

function hideResults() {
    searchResults.classList.remove('active');
}

function showSpinner() {
    searchSpinner.classList.add('active');
}

function hideSpinner() {
    searchSpinner.classList.remove('active');
}

/**
 * Load the selected movie into the player.
 * We leverage the existing StreamFlowPlayer instance.
 */
function playMovie(link, title) {
    hideResults();
    movieSearchInput.value = '';

    // Paste into the URL input and trigger the player
    const urlInput = document.getElementById('videoUrl');
    urlInput.value = link;

    // Trigger StreamFlowPlayer
    if (window.streamFlow) {
        window.streamFlow.loadVideo();
    }
}

// ── Add Movie Modal ───────────────────────────────────────────────────────────
addMovieBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalCancelBtn.addEventListener('click', closeModal);

// Close when clicking backdrop
addMovieModal.addEventListener('click', (e) => {
    if (e.target === addMovieModal) closeModal();
});

// Keyboard: Escape closes modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && addMovieModal.classList.contains('active')) {
        closeModal();
    }
});

modalSaveBtn.addEventListener('click', saveMovie);

// Allow Enter to save from link field
movieLinkInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveMovie();
});
movieTitleInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') movieLinkInput.focus();
});

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

    // Validation
    let hasError = false;
    movieTitleInput.classList.remove('error');
    movieLinkInput.classList.remove('error');

    if (!title) {
        movieTitleInput.classList.add('error');
        movieTitleInput.focus();
        hasError = true;
    }
    if (!link) {
        movieLinkInput.classList.add('error');
        if (!hasError) movieLinkInput.focus();
        hasError = true;
    }
    if (hasError) return;

    // Basic URL sanity check
    try {
        new URL(link);
    } catch {
        movieLinkInput.classList.add('error');
        showModalStatus('error', '⚠ Please enter a valid URL (must start with https://)');
        movieLinkInput.focus();
        return;
    }

    // Save
    modalSaveBtn.disabled = true;
    modalSaveBtn.querySelector('span').textContent = 'Saving…';
    clearModalStatus();

    try {
        const { error } = await supabase
            .from('movies')
            .insert([{ title, link }]);

        if (error) throw error;

        showModalStatus('success', `✓ "${title}" added to the library!`);
        movieTitleInput.value = '';
        movieLinkInput.value = '';

        // Auto-close after short delay
        setTimeout(() => closeModal(), 1600);

    } catch (err) {
        console.error('Insert error:', err);
        showModalStatus('error', `⚠ Failed to save: ${err.message || 'Unknown error'}`);
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
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
