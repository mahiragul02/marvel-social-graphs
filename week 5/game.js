document.addEventListener("DOMContentLoaded", async () => {

    const loadingScreen = document.getElementById("loading-screen");
    const loading = document.getElementById("loading");
    const mysteryCharacter = document.getElementById("mystery-character");
    const choices = document.getElementById("choices");
    const result = document.getElementById("result");
    const nextRound = document.getElementById("next-round");

    let characters = [];
    let zip = null;
    let zipFiles = {};

    let mystery = null;
    let currentChoices = [];
    let mysteryText = "";

    const STOPWORDS = new Set([
        "the","and","for","that","with","this","from",
        "were","was","are","his","her","their","they",
        "have","has","had","been","will","would","could",
        "should","into","about","after","before","which",
        "when","where","what","who","how","also","than",
        "then","them","these","those","there","more","some",
        "such","only","other","another","over","under",
        "between","through","during","while","each","both",
        "many","most","very","can","may","might","not",
        "but","because","its","you","your","our","out",
        "one","two","three","first","second","new"
    ]);

    // --------------------------------------------------
    // LOADING MESSAGE
    // --------------------------------------------------

    function showLoading(message) {
        if (loading) {
            loading.textContent = message;
        }
        console.log(message);
    }

    // --------------------------------------------------
    // NORMALIZE NAME
    // --------------------------------------------------

    function normalizeName(name) {
        return String(name || "")
            .toLowerCase()
            .replace(/\.(html?|txt)$/i, "")
            .replace(/[_-]+/g, " ")
            .replace(/[^\w\s]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // --------------------------------------------------
    // CLEAN TEXT
    // --------------------------------------------------

    function cleanText(text) {

        return String(text || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .toLowerCase()
            .replace(/[^a-z\s]/g, " ")
            .split(/\s+/)
            .filter(word =>
                word.length >= 3 &&
                !STOPWORDS.has(word)
            );
    }

    // --------------------------------------------------
    // BAG OF WORDS
    // --------------------------------------------------

    function makeVector(text) {

        const words = cleanText(text);
        const vector = {};

        for (const word of words) {
            vector[word] =
                (vector[word] || 0) + 1;
        }

        return vector;
    }

    // --------------------------------------------------
    // COSINE SIMILARITY
    // --------------------------------------------------

    function cosineSimilarity(a, b) {

        const allWords = new Set([
            ...Object.keys(a),
            ...Object.keys(b)
        ]);

        let dot = 0;
        let magA = 0;
        let magB = 0;

        for (const word of allWords) {

            const x = a[word] || 0;
            const y = b[word] || 0;

            dot += x * y;
            magA += x * x;
            magB += y * y;
        }

        if (magA === 0 || magB === 0) {
            return 0;
        }

        return dot /
            (Math.sqrt(magA) * Math.sqrt(magB));
    }

    // --------------------------------------------------
    // SHARED WORDS
    // --------------------------------------------------

    function sharedWords(a, b) {

        return Object.keys(a)
            .filter(word => b[word])
            .sort((x, y) =>
                (a[y] + b[y]) -
                (a[x] + b[x])
            )
            .slice(0, 10);
    }

    // --------------------------------------------------
    // LOAD CHARACTER LIST
    // --------------------------------------------------

    async function loadCharacters() {

        showLoading(
            "Loading Marvel character list..."
        );

        const response =
            await fetch("../week1_nodes.tsv");

        if (!response.ok) {
            throw new Error(
                "Could not load week1_nodes.tsv"
            );
        }

        const text =
            await response.text();

        const lines =
            text
                .split(/\r?\n/)
                .filter(line => line.trim());

        const headers =
            lines[0]
                .split("\t")
                .map(x =>
                    x.trim().toLowerCase()
                );

        let nameIndex =
            headers.indexOf("name");

        if (nameIndex === -1) {
            nameIndex =
                headers.indexOf("label");
        }

        if (nameIndex === -1) {
            nameIndex =
                headers.indexOf("title");
        }

        if (nameIndex === -1) {
            throw new Error(
                "No name column found in week1_nodes.tsv"
            );
        }

        characters = [];

        for (let i = 1; i < lines.length; i++) {

            const columns =
                lines[i].split("\t");

            const name =
                columns[nameIndex]?.trim();

            if (!name) continue;

            const lower =
                name.toLowerCase();

            if (
                lower.includes("readme") ||
                lower.includes("license") ||
                lower.includes("metadata")
            ) {
                continue;
            }

            characters.push(name);
        }

        console.log(
            "Characters:",
            characters.length
        );
    }

    // --------------------------------------------------
    // OPEN ZIP
    // --------------------------------------------------

    async function openZip() {

        showLoading(
            "Opening Marvel Wikipedia dataset..."
        );

        const response =
            await fetch("../marvel_pages.zip");

        if (!response.ok) {
            throw new Error(
                "Could not load marvel_pages.zip"
            );
        }

        const buffer =
            await response.arrayBuffer();

        zip =
            await JSZip.loadAsync(buffer);

        // Only INDEX the files.
        // Do NOT read their contents yet.

        zipFiles = {};

        for (const filename of Object.keys(zip.files)) {

            const file =
                zip.files[filename];

            if (file.dir) continue;

            const lower =
                filename.toLowerCase();

            if (
                lower.includes("readme") ||
                lower.includes("license") ||
                lower.includes("metadata") ||
                lower.includes(".git/")
            ) {
                continue;
            }

            if (
                !lower.endsWith(".html") &&
                !lower.endsWith(".htm") &&
                !lower.endsWith(".txt")
            ) {
                continue;
            }

            const shortName =
                filename
                    .split("/")
                    .pop();

            const key =
                normalizeName(shortName);

            if (!zipFiles[key]) {
                zipFiles[key] = file;
            }
        }

        console.log(
            "Indexed ZIP files:",
            Object.keys(zipFiles).length
        );
    }

    // --------------------------------------------------
    // FIND ZIP FILE FOR CHARACTER
    // --------------------------------------------------

    function findFile(characterName) {

        const target =
            normalizeName(characterName);

        if (zipFiles[target]) {
            return zipFiles[target];
        }

        const keys =
            Object.keys(zipFiles);

        for (const key of keys) {

            if (
                key === target ||
                key.includes(target) ||
                target.includes(key)
            ) {
                return zipFiles[key];
            }
        }

        return null;
    }

    // --------------------------------------------------
    // LOAD ONE PAGE ONLY
    // --------------------------------------------------

    async function loadPage(characterName) {

        const file =
            findFile(characterName);

        if (!file) {
            console.warn(
                "No page found for:",
                characterName
            );
            return "";
        }

        try {

            return await file.async("text");

        } catch (error) {

            console.error(
                "Could not read page:",
                characterName,
                error
            );

            return "";
        }
    }

    // --------------------------------------------------
    // CHOOSE RANDOM CHARACTERS
    // --------------------------------------------------

    function randomCharacters(count) {

        const shuffled =
            [...characters]
                .sort(() =>
                    Math.random() - 0.5
                );

        return shuffled.slice(0, count);
    }

    // --------------------------------------------------
    // CREATE ROUND
    // --------------------------------------------------

    async function createRound() {

        choices.innerHTML = "";
        result.innerHTML = "";

        nextRound.style.display =
            "none";

        showLoading(
            "Preparing a new mystery..."
        );

        // Pick mystery
        mystery =
            characters[
                Math.floor(
                    Math.random() *
                    characters.length
                )
            ];

        mysteryCharacter.textContent =
            mystery;

        showLoading(
            "Reading the mystery character..."
        );

        mysteryText =
            await loadPage(mystery);

        if (!mysteryText) {

            result.innerHTML =
                "<p>Could not load this character. Starting another round...</p>";

            setTimeout(
                createRound,
                500
            );

            return;
        }

        // --------------------------------------------------
        // Pick 4 candidate characters
        // --------------------------------------------------

        currentChoices =
            randomCharacters(4);

        // Make sure mystery isn't among choices
        while (
            currentChoices.includes(mystery)
        ) {

            currentChoices =
                randomCharacters(4);
        }

        showLoading(
            "Reading the four possible characters..."
        );

        // Load four pages in parallel
        const candidatePages =
            await Promise.all(
                currentChoices.map(
                    name => loadPage(name)
                )
            );

        const mysteryVector =
            makeVector(mysteryText);

        const scores =
            currentChoices.map(
                (name, index) => {

                    const vector =
                        makeVector(
                            candidatePages[index]
                        );

                    return {
                        name: name,
                        text: candidatePages[index],
                        vector: vector,
                        similarity:
                            cosineSimilarity(
                                mysteryVector,
                                vector
                            )
                    };
                }
            );

        // Highest similarity is the answer
        scores.sort(
            (a, b) =>
                b.similarity -
                a.similarity
        );

        currentChoices =
            scores;

        // --------------------------------------------------
        // DISPLAY BUTTONS
        // --------------------------------------------------

        choices.innerHTML = "";

        scores.forEach(
            (candidate, index) => {

                const button =
                    document.createElement(
                        "button"
                    );

                button.type = "button";

                button.textContent =
                    candidate.name;

                button.className =
                    "choice-button";

                button.addEventListener(
                    "click",
                    () => {

                        handleAnswer(
                            candidate,
                            scores[0]
                        );
                    }
                );

                choices.appendChild(button);
            }
        );

        // Hide loading
        if (loadingScreen) {
            loadingScreen.style.display =
                "none";
        }
    }

    // --------------------------------------------------
    // ANSWER
    // --------------------------------------------------

    function handleAnswer(
        selected,
        correct
    ) {

        const buttons =
            choices.querySelectorAll(
                "button"
            );

        buttons.forEach(button => {

            button.disabled = true;

            if (
                button.textContent ===
                correct.name
            ) {
                button.classList.add(
                    "correct"
                );
            }

            if (
                button.textContent ===
                    selected.name &&
                selected.name !==
                    correct.name
            ) {
                button.classList.add(
                    "wrong"
                );
            }
        });

        const words =
            sharedWords(
                makeVector(mysteryText),
                selected.vector
            );

        const wasCorrect =
            selected.name ===
            correct.name;

        let html = "";

        if (wasCorrect) {

            html += `
                <div class="result-success">
                    <h3>🎉 Correct!</h3>
                    <p>
                        <strong>
                            ${selected.name}
                        </strong>
                        had the highest textual similarity.
                    </p>
                </div>
            `;

        } else {

            html += `
                <div class="result-wrong">
                    <h3>Not quite!</h3>
                    <p>
                        The strongest textual match was
                        <strong>
                            ${correct.name}
                        </strong>.
                    </p>
                </div>
            `;
        }

        html += `
            <div class="similarity-result">

                <p>
                    <strong>
                        Similarity score:
                    </strong>
                    ${selected.similarity.toFixed(3)}
                </p>

                <p>
                    <strong>
                        Best score:
                    </strong>
                    ${correct.similarity.toFixed(3)}
                </p>

                <p>
                    <strong>
                        Shared words:
                    </strong>
                    ${
                        words.length
                            ? words.join(", ")
                            : "No strong shared words"
                    }
                </p>

                <details>
                    <summary>
                        Inspect the underlying text
                    </summary>

                    <p>
                        The score is based on overlapping
                        words between the two Wikipedia
                        pages using a Bag-of-Words
                        representation and cosine similarity.
                    </p>

                    <p>
                        A high similarity score therefore
                        does not necessarily mean that the
                        characters are semantically similar.
                    </p>
                </details>

            </div>
        `;

        result.innerHTML =
            html;

        nextRound.style.display =
            "inline-block";
    }

    // --------------------------------------------------
    // NEXT ROUND
    // --------------------------------------------------

    nextRound.addEventListener(
        "click",
        () => {

            if (loadingScreen) {
                loadingScreen.style.display =
                    "block";
            }

            createRound();
        }
    );

    // --------------------------------------------------
    // ERROR
    // --------------------------------------------------

    function showError(error) {

        console.error(error);

        if (loadingScreen) {
            loadingScreen.style.display =
                "block";
        }

        if (loading) {

            loading.innerHTML = `
                <div style="
                    color:#b00020;
                    padding:20px;
                ">
                    <strong>
                        Game could not start.
                    </strong>

                    <br><br>

                    ${error.message}

                    <br><br>

                    Open the browser page again
                    and refresh with Ctrl + F5.
                </div>
            `;
        }
    }

    // --------------------------------------------------
    // START
    // --------------------------------------------------

    try {

        await loadCharacters();

        await openZip();

        await createRound();

    } catch (error) {

        showError(error);
    }

});
