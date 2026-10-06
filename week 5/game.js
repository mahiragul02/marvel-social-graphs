document.addEventListener("DOMContentLoaded", async function () {

    const loadingScreen = document.getElementById("loading-screen");
    const loading = document.getElementById("loading");
    const mysteryCharacter = document.getElementById("mystery-character");
    const choices = document.getElementById("choices");
    const result = document.getElementById("result");
    const nextRound = document.getElementById("next-round");

    let characters = [];
    let pageFiles = {};
    let currentMystery = "";
    let currentMysteryText = "";
    let currentCandidates = [];

    // --------------------------------------------------
    // STATUS MESSAGE
    // --------------------------------------------------

    function status(message) {
        console.log(message);

        if (loading) {
            loading.textContent = message;
        }
    }

    // --------------------------------------------------
    // NORMALIZE NAMES
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
            .replace(/&amp;/gi, " ")
            .toLowerCase()
            .replace(/[^a-z\s]/g, " ")
            .split(/\s+/)
            .filter(word => word.length >= 3);

    }

    // --------------------------------------------------
    // BAG OF WORDS
    // --------------------------------------------------

    function makeVector(text) {

        const words = cleanText(text);
        const vector = {};

        words.forEach(word => {
            vector[word] = (vector[word] || 0) + 1;
        });

        return vector;
    }

    // --------------------------------------------------
    // COSINE SIMILARITY
    // --------------------------------------------------

    function cosineSimilarity(a, b) {

        const words = new Set([
            ...Object.keys(a),
            ...Object.keys(b)
        ]);

        let dot = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        words.forEach(word => {

            const x = a[word] || 0;
            const y = b[word] || 0;

            dot += x * y;
            magnitudeA += x * x;
            magnitudeB += y * y;

        });

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dot /
            (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
    }

    // --------------------------------------------------
    // SHARED WORDS
    // --------------------------------------------------

    function getSharedWords(a, b) {

        return Object.keys(a)
            .filter(word => b[word])
            .sort((x, y) => {
                return (a[y] + b[y]) - (a[x] + b[x]);
            })
            .slice(0, 10);
    }

    // --------------------------------------------------
    // LOAD CHARACTER LIST
    // --------------------------------------------------

    async function loadCharacters() {

        status("Loading Marvel character list...");

        const response = await fetch("../week1_nodes.tsv");

        if (!response.ok) {
            throw new Error("Could not load week1_nodes.tsv");
        }

        const text = await response.text();

        const lines = text
            .split(/\r?\n/)
            .filter(line => line.trim());

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
            throw new Error("Could not find character name column.");
        }

        characters = [];

        for (let i = 1; i < lines.length; i++) {

            const columns = lines[i].split("\t");
            const name = columns[nameIndex]?.trim();

            if (!name) {
                continue;
            }

            const lower = name.toLowerCase();

            if (
                lower.includes("readme") ||
                lower.includes("license") ||
                lower.includes("metadata")
            ) {
                continue;
            }

            characters.push(name);
        }

        console.log("Characters loaded:", characters.length);
    }

    // --------------------------------------------------
    // LOAD ZIP FILE
    // --------------------------------------------------

    async function loadZip() {

        status("Loading Marvel Wikipedia dataset...");

        const response = await fetch("../marvel_pages.zip");

        if (!response.ok) {
            throw new Error("Could not load marvel_pages.zip");
        }

        status("Opening Marvel Wikipedia dataset...");

        const buffer = await response.arrayBuffer();

        const zip = await JSZip.loadAsync(buffer);

        const filenames = Object.keys(zip.files).filter(filename => {

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

        console.log("Pages found:", filenames.length);

        // Store only filenames.
        // We do NOT read all 304 pages now.
        // This makes the game much faster.

        pageFiles = {};

        filenames.forEach(filename => {

            const shortName = filename.split("/").pop();
            const key = normalizeName(shortName);

            if (!pageFiles[key]) {
                pageFiles[key] = filename;
            }

        });

        console.log(
            "Page index created:",
            Object.keys(pageFiles).length
        );
    }

    // --------------------------------------------------
    // FIND PAGE FILE
    // --------------------------------------------------

    function findPageFile(characterName) {

        const target = normalizeName(characterName);

        // Exact match first
        if (pageFiles[target]) {
            return pageFiles[target];
        }

        // Partial match only as fallback
        const keys = Object.keys(pageFiles);

        for (const key of keys) {

            if (
                key === target ||
                key.includes(target) ||
                target.includes(key)
            ) {
                return pageFiles[key];
            }

        }

        return null;
    }

    // --------------------------------------------------
    // READ ONE PAGE
    // --------------------------------------------------

    async function readPage(zip, filename) {

        if (!filename) {
            return "";
        }

        try {
            return await zip.files[filename].async("text");
        }
        catch (error) {

            console.warn(
                "Could not read page:",
                filename
            );

            return "";
        }
    }

    // --------------------------------------------------
    // GET RANDOM CHARACTERS
    // --------------------------------------------------

    function getRandomCharacters(number, excluded) {

        const available = characters.filter(name => {

            if (excluded.includes(name)) {
                return false;
            }

            return findPageFile(name) !== null;
        });

        const shuffled = [...available];

        for (let i = shuffled.length - 1; i > 0; i--) {

            const j = Math.floor(Math.random() * (i + 1));

            [shuffled[i], shuffled[j]] =
                [shuffled[j], shuffled[i]];
        }

        return shuffled.slice(0, number);
    }

    // --------------------------------------------------
    // CREATE GAME ROUND
    // --------------------------------------------------

    async function createRound(zip) {

        status("Preparing a new mystery character...");

        result.innerHTML = "";
        choices.innerHTML = "";
        nextRound.style.display = "none";

        // Find characters with available pages
        const availableCharacters = characters.filter(name => {
            return findPageFile(name) !== null;
        });

        if (availableCharacters.length < 5) {
            throw new Error(
                "Not enough Marvel pages were found."
            );
        }

        // Pick mystery character
        currentMystery =
            availableCharacters[
                Math.floor(
                    Math.random() *
                    availableCharacters.length
                )
            ];

        const mysteryFile =
            findPageFile(currentMystery);

        status("Reading mystery character page...");

        currentMysteryText =
            await readPage(zip, mysteryFile);

        // Pick four possible answers
        currentCandidates =
            getRandomCharacters(
                4,
                [currentMystery]
            );

        if (currentCandidates.length < 4) {
            throw new Error(
                "Could not find four candidate characters."
            );
        }

        status("Reading candidate pages...");

        const candidateData = [];

        for (const name of currentCandidates) {

            const filename = findPageFile(name);

            const text =
                await readPage(zip, filename);

            candidateData.push({
                name: name,
                text: text
            });
        }

        // Calculate mystery vector
        status("Calculating textual similarity...");

        const mysteryVector =
            makeVector(currentMysteryText);

        // Calculate candidate similarity
        candidateData.forEach(candidate => {

            candidate.vector =
                makeVector(candidate.text);

            candidate.similarity =
                cosineSimilarity(
                    mysteryVector,
                    candidate.vector
                );

        });

        // Highest similarity is the correct answer
        candidateData.sort(
            (a, b) =>
                b.similarity - a.similarity
        );

        currentCandidates = candidateData;

        // Display mystery
        mysteryCharacter.textContent =
            currentMystery;

        // Display buttons
        choices.innerHTML = "";

        candidateData.forEach(candidate => {

            const button =
                document.createElement("button");

            button.type = "button";
            button.className = "choice-button";

            button.textContent =
                candidate.name;

            button.addEventListener(
                "click",
                function () {

                    handleAnswer(
                        candidate,
                        candidateData[0],
                        mysteryVector
                    );

                }
            );

            choices.appendChild(button);

        });

        // Hide loading screen
        loadingScreen.style.display = "none";

        console.log(
            "Game round ready!",
            currentMystery
        );
    }

    // --------------------------------------------------
    // HANDLE ANSWER
    // --------------------------------------------------

    function handleAnswer(
        selected,
        correct,
        mysteryVector
    ) {

        const buttons =
            choices.querySelectorAll("button");

        buttons.forEach(button => {

            button.disabled = true;

            if (
                button.textContent ===
                correct.name
            ) {
                button.classList.add("correct");
            }

            if (
                button.textContent ===
                selected.name &&
                selected.name !== correct.name
            ) {
                button.classList.add("wrong");
            }

        });

        const sharedWords =
            getSharedWords(
                mysteryVector,
                selected.vector
            );

        const isCorrect =
            selected.name === correct.name;

        let html = "";

        if (isCorrect) {

            html += `
                <div class="result-success">
                    <h3>🎉 Correct!</h3>

                    <p>
                        <strong>${selected.name}</strong>
                        had the highest textual similarity
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
                        <strong>${correct.name}</strong>.
                    </p>
                </div>
            `;

        }

        html += `
            <div class="similarity-result">

                <p>
                    <strong>Your choice similarity:</strong>
                    ${selected.similarity.toFixed(3)}
                </p>

                <p>
                    <strong>Best similarity:</strong>
                    ${correct.similarity.toFixed(3)}
                </p>

                <p>
                    <strong>Shared words:</strong>
                    ${
                        sharedWords.length
                        ? sharedWords.join(", ")
                        : "No strong shared words found."
                    }
                </p>

                <details>

                    <summary>
                        Inspect the underlying text
                    </summary>

                    <p>
                        The score is based on
                        overlapping words between
                        the two Wikipedia pages.
                    </p>

                    <p>
                        This is a Bag-of-Words approach,
                        so it does not understand word
                        order or deeper semantic meaning.
                    </p>

                </details>

            </div>
        `;

        result.innerHTML = html;

        nextRound.style.display = "inline-block";
    }

    // --------------------------------------------------
    // MAIN STARTUP
    // --------------------------------------------------

    async function startGame() {

        try {

            status("Starting Marvel Text Detective...");

            await loadCharacters();

            await loadZip();

            // Load ZIP again so createRound can use it.
            // JSZip keeps the small 1.75 MB file in memory.
            const response =
                await fetch("../marvel_pages.zip");

            const buffer =
                await response.arrayBuffer();

            const zip =
                await JSZip.loadAsync(buffer);

            await createRound(zip);

        }
        catch (error) {

            console.error(
                "GAME ERROR:",
                error
            );

            loadingScreen.style.display = "block";

            loading.innerHTML = `
                <div style="
                    color:#b00020;
                    padding:20px;
                ">

                    <strong>
                        Game error
                    </strong>

                    <br><br>

                    ${error.message}

                </div>
            `;

        }

    }

    // --------------------------------------------------
    // NEXT ROUND
    // --------------------------------------------------

    nextRound.addEventListener(
        "click",
        async function () {

            try {

                loadingScreen.style.display =
                    "block";

                status(
                    "Preparing the next round..."
                );

                // Re-open ZIP for the new round
                const response =
                    await fetch("../marvel_pages.zip");

                const buffer =
                    await response.arrayBuffer();

                const zip =
                    await JSZip.loadAsync(buffer);

                await createRound(zip);

            }
            catch (error) {

                console.error(error);

                loadingScreen.style.display =
                    "block";

                loading.innerHTML = `
                    <div style="
                        color:#b00020;
                        padding:20px;
                    ">
                        <strong>
                            Game error
                        </strong>

                        <br><br>

                        ${error.message}
                    </div>
                `;

            }

        }
    );

    // START GAME
    startGame();

});
