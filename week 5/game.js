document.addEventListener("DOMContentLoaded", () => {

    // ---------------------------------------------------------
    // ELEMENTS
    // ---------------------------------------------------------

    const loading = document.getElementById("loading");
    const mysteryCharacter = document.getElementById("mystery-character");
    const choices = document.getElementById("choices");
    const result = document.getElementById("result");
    const nextRoundButton = document.getElementById("next-round");

    // ---------------------------------------------------------
    // SETTINGS
    // ---------------------------------------------------------

    const NUM_CHOICES = 4;

    let characters = [];
    let pages = {};
    let vectors = {};
    let currentMystery = null;
    let currentChoices = [];

    // ---------------------------------------------------------
    // STOP WORDS
    // ---------------------------------------------------------

    const STOPWORDS = new Set([
        "the", "and", "for", "that", "with", "this", "from",
        "are", "was", "were", "his", "her", "their", "they",
        "have", "has", "had", "been", "will", "would", "could",
        "should", "into", "about", "after", "before", "which",
        "when", "where", "what", "who", "how", "also", "than",
        "then", "them", "these", "those", "there", "here",
        "more", "some", "such", "only", "other", "another",
        "over", "under", "between", "through", "during",
        "while", "each", "both", "many", "most", "very",
        "can", "may", "might", "not", "but", "because",
        "its", "it's", "you", "your", "our", "out", "one",
        "two", "three", "first", "second", "new", "used",
        "use", "using", "known", "including", "called"
    ]);

    // ---------------------------------------------------------
    // HELPER: UPDATE LOADING MESSAGE
    // ---------------------------------------------------------

    function setLoading(message) {
        if (loading) {
            loading.textContent = message;
        }
    }

    // ---------------------------------------------------------
    // NORMALIZE NAMES
    // ---------------------------------------------------------

    function normalizeName(name) {
        return String(name || "")
            .toLowerCase()
            .replace(/\.html?$/i, "")
            .replace(/\.txt$/i, "")
            .replace(/[_-]+/g, " ")
            .replace(/[^\w\s]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // ---------------------------------------------------------
    // CLEAN TEXT
    // ---------------------------------------------------------

    function cleanText(text) {

        // Remove HTML
        let cleaned = String(text || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ");

        // Decode common HTML entities
        cleaned = cleaned
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");

        // Lowercase
        cleaned = cleaned.toLowerCase();

        // Keep letters and spaces
        cleaned = cleaned.replace(/[^a-z\s]/g, " ");

        // Split into words
        const words = cleaned.split(/\s+/);

        // Remove short words and stopwords
        const usefulWords = words.filter(word => {
            return (
                word.length >= 3 &&
                !STOPWORDS.has(word)
            );
        });

        return usefulWords;
    }

    // ---------------------------------------------------------
    // BAG OF WORDS
    // ---------------------------------------------------------

    function makeVector(text) {

        const words = cleanText(text);

        const vector = {};

        for (const word of words) {
            vector[word] = (vector[word] || 0) + 1;
        }

        return vector;
    }

    // ---------------------------------------------------------
    // COSINE SIMILARITY
    // ---------------------------------------------------------

    function cosineSimilarity(a, b) {

        const keys = new Set([
            ...Object.keys(a),
            ...Object.keys(b)
        ]);

        let dot = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        for (const key of keys) {

            const x = a[key] || 0;
            const y = b[key] || 0;

            dot += x * y;
            magnitudeA += x * x;
            magnitudeB += y * y;
        }

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dot /
            (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
    }

    // ---------------------------------------------------------
    // SHARED WORDS
    // ---------------------------------------------------------

    function getSharedWords(a, b) {

        const shared = [];

        for (const word of Object.keys(a)) {

            if (b[word]) {
                shared.push({
                    word: word,
                    score: Math.min(a[word], b[word])
                });
            }
        }

        shared.sort((x, y) => y.score - x.score);

        return shared
            .slice(0, 12)
            .map(item => item.word);
    }

    // ---------------------------------------------------------
    // LOAD TSV
    // ---------------------------------------------------------

    async function loadCharacters() {

        setLoading("Loading Marvel character list...");

        const response = await fetch("../week1_nodes.tsv");

        if (!response.ok) {
            throw new Error(
                "Could not load week1_nodes.tsv"
            );
        }

        const text = await response.text();

        const lines = text
            .split(/\r?\n/)
            .filter(line => line.trim());

        if (lines.length < 2) {
            throw new Error(
                "week1_nodes.tsv appears to be empty."
            );
        }

        const headers = lines[0]
            .split("\t")
            .map(h => h.trim().toLowerCase());

        let nameIndex = headers.indexOf("name");

        if (nameIndex === -1) {
            nameIndex = headers.indexOf("label");
        }

        if (nameIndex === -1) {
            nameIndex = headers.indexOf("title");
        }

        if (nameIndex === -1) {
            throw new Error(
                "Could not find a name column in week1_nodes.tsv."
            );
        }

        characters = [];

        for (let i = 1; i < lines.length; i++) {

            const columns = lines[i].split("\t");

            const name = columns[nameIndex]?.trim();

            if (!name) continue;

            const lower = name.toLowerCase();

            // Ignore unwanted entries
            if (
                lower.includes("readme") ||
                lower.includes("license") ||
                lower.includes("metadata")
            ) {
                continue;
            }

            characters.push({
                name: name
            });
        }

        console.log(
            "Characters loaded:",
            characters.length
        );
    }

    // ---------------------------------------------------------
    // LOAD ZIP
    // ---------------------------------------------------------

    async function loadMarvelPages() {

        setLoading(
            "Loading Marvel Wikipedia pages..."
        );

        const response = await fetch("../marvel_pages.zip");

        if (!response.ok) {
            throw new Error(
                "Could not load marvel_pages.zip"
            );
        }

        const arrayBuffer = await response.arrayBuffer();

        setLoading(
            "Opening Marvel Wikipedia dataset..."
        );

        const zip = await JSZip.loadAsync(arrayBuffer);

        // -----------------------------------------------------
        // FIND ONLY REAL PAGE FILES
        // -----------------------------------------------------

        const pageFiles = Object.keys(zip.files).filter(filename => {

            const lower = filename.toLowerCase();

            if (zip.files[filename].dir) {
                return false;
            }

            if (
                lower.includes("readme") ||
                lower.includes("license") ||
                lower.includes("metadata") ||
                lower.includes(".git/")
            ) {
                return false;
            }

            return (
                lower.endsWith(".html") ||
                lower.endsWith(".htm") ||
                lower.endsWith(".txt")
            );
        });

        console.log(
            "Wikipedia page files found:",
            pageFiles.length
        );

        setLoading(
            `Found ${pageFiles.length} Wikipedia pages. Reading them...`
        );

        // -----------------------------------------------------
        // IMPORTANT:
        // READ FILES IN PARALLEL
        // This is much faster than reading them one by one.
        // -----------------------------------------------------

        const loadedPages = await Promise.all(

            pageFiles.map(async filename => {

                try {

                    const text =
                        await zip.files[filename]
                            .async("text");

                    const cleanFilename =
                        filename
                            .split("/")
                            .pop();

                    const key =
                        normalizeName(cleanFilename);

                    return {
                        key: key,
                        filename: cleanFilename,
                        text: text
                    };

                } catch (error) {

                    console.warn(
                        "Could not read:",
                        filename
                    );

                    return null;
                }
            })
        );

        pages = {};

        for (const page of loadedPages) {

            if (!page) continue;

            if (!pages[page.key]) {
                pages[page.key] = page.text;
            }
        }

        console.log(
            "Pages successfully loaded:",
            Object.keys(pages).length
        );
    }

    // ---------------------------------------------------------
    // FIND PAGE FOR CHARACTER
    // ---------------------------------------------------------

    function findPageForCharacter(characterName) {

        const target = normalizeName(characterName);

        // Exact match first
        if (pages[target]) {
            return pages[target];
        }

        // Try partial matching
        for (const key of Object.keys(pages)) {

            if (
                key === target ||
                key.includes(target) ||
                target.includes(key)
            ) {
                return pages[key];
            }
        }

        return null;
    }

    // ---------------------------------------------------------
    // BUILD VECTORS
    // ---------------------------------------------------------

    async function buildVectors() {

        setLoading(
            "Preparing text similarity model..."
        );

        vectors = {};

        let found = 0;

        for (let i = 0; i < characters.length; i++) {

            const character = characters[i];

            const page =
                findPageForCharacter(
                    character.name
                );

            if (!page) {
                continue;
            }

            vectors[character.name] =
                makeVector(page);

            found++;

            // Allow browser to update the loading screen
            if (i % 20 === 0) {

                setLoading(
                    `Preparing text model... ${i + 1}/${characters.length}`
                );

                await new Promise(resolve =>
                    setTimeout(resolve, 0)
                );
            }
        }

        console.log(
            "Vectors created:",
            found
        );

        if (found < 10) {
            throw new Error(
                "Too few Marvel Wikipedia pages could be matched with the character list."
            );
        }
    }

    // ---------------------------------------------------------
    // FIND MOST SIMILAR CHARACTERS
    // ---------------------------------------------------------

    function getSimilarCharacters(mysteryName) {

        const mysteryVector =
            vectors[mysteryName];

        if (!mysteryVector) {
            return [];
        }

        const similarities = [];

        for (const character of characters) {

            const name = character.name;

            if (name === mysteryName) {
                continue;
            }

            if (!vectors[name]) {
                continue;
            }

            const similarity =
                cosineSimilarity(
                    mysteryVector,
                    vectors[name]
                );

            similarities.push({
                name: name,
                similarity: similarity
            });
        }

        similarities.sort(
            (a, b) =>
                b.similarity - a.similarity
        );

        return similarities;
    }

    // ---------------------------------------------------------
    // SHUFFLE
    // ---------------------------------------------------------

    function shuffle(array) {

        const result = [...array];

        for (
            let i = result.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );

            [
                result[i],
                result[j]
            ] = [
                result[j],
                result[i]
            ];
        }

        return result;
    }

    // ---------------------------------------------------------
    // CREATE ROUND
    // ---------------------------------------------------------

    function createRound() {

        result.innerHTML = "";
        nextRoundButton.style.display = "none";

        choices.innerHTML = "";

        // Choose a mystery character
        const available =
            characters.filter(
                character =>
                    vectors[character.name]
            );

        if (available.length < NUM_CHOICES + 1) {

            throw new Error(
                "Not enough characters available for the game."
            );
        }

        currentMystery =
            available[
                Math.floor(
                    Math.random() *
                    available.length
                )
            ];

        const mysteryName =
            currentMystery.name;

        mysteryCharacter.textContent =
            mysteryName;

        // -----------------------------------------------------
        // Find the actual most similar character
        // -----------------------------------------------------

        const similar =
            getSimilarCharacters(
                mysteryName
            );

        if (similar.length < 3) {

            throw new Error(
                "Could not find enough similar characters."
            );
        }

        // The correct answer is the strongest match
        const correctAnswer =
            similar[0];

        // Add 3 random distractors
        const distractors =
            shuffle(
                available.filter(
                    character =>
                        character.name !==
                            mysteryName &&
                        character.name !==
                            correctAnswer.name
                )
            ).slice(0, 3);

        currentChoices = shuffle([
            {
                name: correctAnswer.name,
                correct: true
            },
            ...distractors.map(character => ({
                name: character.name,
                correct: false
            }))
        ]);

        // -----------------------------------------------------
        // Create answer buttons
        // -----------------------------------------------------

        currentChoices.forEach(
            choice => {

                const button =
                    document.createElement("button");

                button.type = "button";

                button.textContent =
                    choice.name;

                button.className =
                    "choice-button";

                button.addEventListener(
                    "click",
                    event => {

                        event.preventDefault();
                        event.stopPropagation();

                        handleAnswer(
                            choice.name,
                            correctAnswer.name
                        );
                    }
                );

                choices.appendChild(button);
            }
        );
    }

    // ---------------------------------------------------------
    // HANDLE ANSWER
    // ---------------------------------------------------------

    function handleAnswer(
        selectedName,
        correctName
    ) {

        const buttons =
            choices.querySelectorAll(
                "button"
            );

        buttons.forEach(button => {

            button.disabled = true;

            if (
                button.textContent ===
                correctName
            ) {
                button.classList.add(
                    "correct"
                );
            }

            if (
                button.textContent ===
                selectedName &&
                selectedName !== correctName
            ) {
                button.classList.add(
                    "wrong"
                );
            }
        });

        const mysteryVector =
            vectors[currentMystery.name];

        const selectedVector =
            vectors[selectedName];

        const correctVector =
            vectors[correctName];

        const selectedSimilarity =
            cosineSimilarity(
                mysteryVector,
                selectedVector
            );

        const correctSimilarity =
            cosineSimilarity(
                mysteryVector,
                correctVector
            );

        const sharedWords =
            getSharedWords(
                mysteryVector,
                selectedVector
            );

        // -----------------------------------------------------
        // NETWORK CONNECTION
        // -----------------------------------------------------

        let networkConnection =
            "Not checked";

        // We use a cached network if available
        if (window.marvelEdges) {

            const pair =
                [
                    currentMystery.name,
                    selectedName
                ].sort();

            const edgeKey =
                pair.join("|||");

            networkConnection =
                window.marvelEdges.has(edgeKey)
                    ? "Yes — directly connected"
                    : "No direct connection";
        }

        // -----------------------------------------------------
        // RESULT
        // -----------------------------------------------------

        const correct =
            selectedName === correctName;

        let html = "";

        if (correct) {

            html += `
                <div class="result-success">
                    <h3>🎉 Correct!</h3>
                    <p>
                        <strong>${selectedName}</strong>
                        was the most textually similar character
                        among the four choices.
                    </p>
                </div>
            `;

        } else {

            html += `
                <div class="result-wrong">
                    <h3>Not quite!</h3>
                    <p>
                        The strongest textual match was
                        <strong>${correctName}</strong>.
                    </p>
                </div>
            `;
        }

        html += `
            <div class="similarity-result">

                <p>
                    <strong>Your choice similarity:</strong>
                    ${selectedSimilarity.toFixed(3)}
                </p>

                <p>
                    <strong>Best-match similarity:</strong>
                    ${correctSimilarity.toFixed(3)}
                </p>

                <p>
                    <strong>Shared words:</strong>
                    ${
                        sharedWords.length
                            ? sharedWords.join(", ")
                            : "None found"
                    }
                </p>

                <p>
                    <strong>Direct network connection:</strong>
                    ${networkConnection}
                </p>

                <details>
                    <summary>
                        Inspect the underlying Wikipedia text
                    </summary>

                    <p>
                        The similarity is based on
                        overlapping words in the Wikipedia pages.
                        This means that a high score does not
                        necessarily mean the characters are
                        semantically similar.
                    </p>
                </details>

            </div>
        `;

        result.innerHTML = html;

        nextRoundButton.style.display =
            "inline-block";
    }

    // ---------------------------------------------------------
    // LOAD NETWORK
    // ---------------------------------------------------------

    async function loadNetwork() {

        try {

            const response =
                await fetch("../week1_edges.tsv");

            if (!response.ok) {
                return;
            }

            const text =
                await response.text();

            const lines =
                text
                    .split(/\r?\n/)
                    .filter(line =>
                        line.trim()
                    );

            if (lines.length < 2) {
                return;
            }

            const headers =
                lines[0]
                    .split("\t")
                    .map(h =>
                        h.trim().toLowerCase()
                    );

            let sourceIndex =
                headers.indexOf("source");

            let targetIndex =
                headers.indexOf("target");

            if (
                sourceIndex === -1 ||
                targetIndex === -1
            ) {

                sourceIndex = 0;
                targetIndex = 1;
            }

            window.marvelEdges =
                new Set();

            for (
                let i = 1;
                i < lines.length;
                i++
            ) {

                const columns =
                    lines[i].split("\t");

                const source =
                    columns[sourceIndex]?.trim();

                const target =
                    columns[targetIndex]?.trim();

                if (!source || !target) {
                    continue;
                }

                const pair =
                    [
                        normalizeName(source),
                        normalizeName(target)
                    ].sort();

                window.marvelEdges.add(
                    pair.join("|||")
                );
            }

            console.log(
                "Network edges loaded:",
                window.marvelEdges.size
            );

        } catch (error) {

            console.warn(
                "Network could not be loaded:",
                error
            );
        }
    }

    // ---------------------------------------------------------
    // NEXT ROUND
    // ---------------------------------------------------------

    nextRoundButton.addEventListener(
        "click",
        event => {

            event.preventDefault();

            createRound();
        }
    );

    // ---------------------------------------------------------
    // ERROR DISPLAY
    // ---------------------------------------------------------

    function showError(error) {

        console.error(error);

        if (loading) {

            loading.innerHTML = `
                <div style="color:#b00020;">
                    <strong>Something went wrong.</strong>
                    <br><br>
                    ${error.message}
                    <br><br>
                    Please refresh the page and try again.
                </div>
            `;
        }
    }

    // ---------------------------------------------------------
    // START GAME
    // ---------------------------------------------------------

    async function startGame() {

        try {

            console.log(
                "Marvel Text Detective starting..."
            );

            setLoading(
                "Starting Marvel Text Detective..."
            );

            // 1. Load character names
            await loadCharacters();

            // 2. Load network in parallel with ZIP
            const networkPromise =
                loadNetwork();

            // 3. Load Wikipedia pages
            await loadMarvelPages();

            // 4. Build text vectors
            await buildVectors();

            // Make sure network loading has finished
            await networkPromise;

            // 5. Hide loading screen
            const loadingScreen =
                document.getElementById(
                    "loading-screen"
                );

            if (loadingScreen) {
                loadingScreen.style.display =
                    "none";
            }

            // 6. Start game
            createRound();

            console.log(
                "Marvel Text Detective ready!"
            );

        } catch (error) {

            showError(error);
        }
    }

    // ---------------------------------------------------------
    // START
    // ---------------------------------------------------------

    startGame();

});
