document.addEventListener("DOMContentLoaded", async function () {

    // =========================================================
    // GET HTML ELEMENTS
    // =========================================================

    const loadingScreen = document.getElementById("loading-screen");
    const loading = document.getElementById("loading");
    const mysteryCharacter = document.getElementById("mystery-character");
    const choices = document.getElementById("choices");
    const result = document.getElementById("result");
    const nextRound = document.getElementById("next-round");

    let zip = null;

    // List of Marvel pages
    let pages = [];

    // Current mystery character
    let currentMystery = null;

    // Current four answer choices
    let currentCandidates = [];


    // =========================================================
    // SHOW LOADING MESSAGE
    // =========================================================

    function status(message) {

        console.log(message);

        if (loading) {
            loading.textContent = message;
        }
    }


    // =========================================================
    // CLEAN CHARACTER NAME
    // =========================================================

    function cleanCharacterName(filename) {

        let name = filename.split("/").pop();

        // Remove file extension
        name = name.replace(/\.(html?|txt)$/i, "");

        // Decode URL characters if present
        try {
            name = decodeURIComponent(name);
        } catch (error) {
            // Keep original name if decoding fails
        }

        // Replace underscores and hyphens with spaces
        name = name.replace(/[_-]+/g, " ");

        // Remove extra spaces
        name = name.replace(/\s+/g, " ").trim();

        return name;
    }


    // =========================================================
    // NORMALIZE TEXT
    // =========================================================

    function cleanText(text) {

        return String(text || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, " ")
            .replace(/&quot;/gi, " ")
            .replace(/&#39;/gi, " ")
            .toLowerCase()
            .replace(/[^a-z\s]/g, " ")
            .split(/\s+/)
            .filter(word => word.length >= 3);

    }


    // =========================================================
    // BAG OF WORDS
    // =========================================================

    function makeVector(text) {

        const words = cleanText(text);

        const vector = {};

        words.forEach(word => {

            if (!vector[word]) {
                vector[word] = 0;
            }

            vector[word]++;

        });

        return vector;
    }


    // =========================================================
    // COSINE SIMILARITY
    // =========================================================

    function cosineSimilarity(a, b) {

        const allWords = new Set([
            ...Object.keys(a),
            ...Object.keys(b)
        ]);

        let dotProduct = 0;

        let magnitudeA = 0;

        let magnitudeB = 0;


        allWords.forEach(word => {

            const valueA = a[word] || 0;

            const valueB = b[word] || 0;

            dotProduct += valueA * valueB;

            magnitudeA += valueA * valueA;

            magnitudeB += valueB * valueB;

        });


        if (magnitudeA === 0 || magnitudeB === 0) {

            return 0;

        }


        return dotProduct /
            (
                Math.sqrt(magnitudeA) *
                Math.sqrt(magnitudeB)
            );

    }


    // =========================================================
    // FIND SHARED WORDS
    // =========================================================

    function getSharedWords(vectorA, vectorB) {

        return Object.keys(vectorA)

            .filter(word => vectorB[word])

            .sort((a, b) => {

                return (
                    vectorA[b] + vectorB[b]
                ) -
                (
                    vectorA[a] + vectorB[a]
                );

            })

            .slice(0, 10);

    }


    // =========================================================
    // LOAD ZIP FILE
    // =========================================================

    async function loadDataset() {

        status("Loading Marvel Wikipedia dataset...");


        const response =
            await fetch("../marvel_pages.zip");


        if (!response.ok) {

            throw new Error(
                "Could not load marvel_pages.zip"
            );

        }


        status("Opening Marvel Wikipedia dataset...");


        const buffer =
            await response.arrayBuffer();


        zip =
            await JSZip.loadAsync(buffer);


        // -----------------------------------------------------
        // FIND PAGE FILES
        // -----------------------------------------------------

        const filenames =
            Object.keys(zip.files).filter(filename => {

                const lower =
                    filename.toLowerCase();


                // Ignore folders
                if (zip.files[filename].dir) {
                    return false;
                }


                // Ignore unwanted files
                if (
                    lower.includes("readme") ||
                    lower.includes("license") ||
                    lower.includes("metadata") ||
                    lower.includes(".git/")
                ) {
                    return false;
                }


                // Only use web/text pages
                return (
                    lower.endsWith(".html") ||
                    lower.endsWith(".htm") ||
                    lower.endsWith(".txt")
                );

            });


        if (filenames.length === 0) {

            throw new Error(
                "No Marvel Wikipedia pages were found in the ZIP file."
            );

        }


        // -----------------------------------------------------
        // CREATE PAGE LIST
        // -----------------------------------------------------

        pages = filenames.map(filename => {

            return {

                filename: filename,

                name: cleanCharacterName(filename)

            };

        });


        console.log(
            "Marvel pages found:",
            pages.length
        );


        status(
            "SUCCESS! " +
            pages.length +
            " Marvel pages loaded."
        );


        // Give the browser a moment to display message
        await new Promise(resolve =>
            setTimeout(resolve, 500)
        );

    }


    // =========================================================
    // READ ONE PAGE
    // =========================================================

    async function readPage(page) {

        if (!page) {
            return "";
        }


        try {

            return await zip.files[
                page.filename
            ].async("text");

        }

        catch (error) {

            console.error(
                "Could not read page:",
                page.filename,
                error
            );

            return "";

        }

    }


    // =========================================================
    // SHUFFLE ARRAY
    // =========================================================

    function shuffle(array) {

        const copy = [...array];


        for (
            let i = copy.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );


            [
                copy[i],
                copy[j]
            ] =
            [
                copy[j],
                copy[i]
            ];

        }


        return copy;

    }


    // =========================================================
    // CREATE A NEW ROUND
    // =========================================================

    async function createRound() {

        try {

            status(
                "Preparing a new mystery character..."
            );


            // Clear previous game
            result.innerHTML = "";

            choices.innerHTML = "";

            nextRound.style.display = "none";


            // -------------------------------------------------
            // CHECK DATASET
            // -------------------------------------------------

            if (pages.length < 5) {

                throw new Error(
                    "Not enough Marvel pages were found."
                );

            }


            // -------------------------------------------------
            // SELECT MYSTERY CHARACTER
            // -------------------------------------------------

            const shuffledPages =
                shuffle(pages);


            currentMystery =
                shuffledPages[0];


            // -------------------------------------------------
            // READ MYSTERY PAGE
            // -------------------------------------------------

            status(
                "Reading mystery character page..."
            );


            const mysteryText =
                await readPage(currentMystery);


            if (!mysteryText) {

                throw new Error(
                    "Could not read the mystery character page."
                );

            }


            // -------------------------------------------------
            // SELECT FOUR OTHER CHARACTERS
            // -------------------------------------------------

            currentCandidates =
                shuffledPages
                    .slice(1, 5);


            if (
                currentCandidates.length < 4
            ) {

                throw new Error(
                    "Could not create four answer choices."
                );

            }


            // -------------------------------------------------
            // READ FOUR CANDIDATE PAGES
            // -------------------------------------------------

            status(
                "Reading four candidate pages..."
            );


            const candidateData = [];


            for (
                const candidate of currentCandidates
            ) {

                const text =
                    await readPage(candidate);


                candidateData.push({

                    page: candidate,

                    name: candidate.name,

                    text: text,

                    vector: null,

                    similarity: 0

                });

            }


            // -------------------------------------------------
            // CALCULATE SIMILARITY
            // -------------------------------------------------

            status(
                "Calculating textual similarity..."
            );


            const mysteryVector =
                makeVector(mysteryText);


            candidateData.forEach(candidate => {

                candidate.vector =
                    makeVector(candidate.text);


                candidate.similarity =
                    cosineSimilarity(
                        mysteryVector,
                        candidate.vector
                    );

            });


            // -------------------------------------------------
            // SORT BY SIMILARITY
            // -------------------------------------------------

            candidateData.sort(
                (a, b) =>
                    b.similarity -
                    a.similarity
            );


            currentCandidates =
                candidateData;


            // -------------------------------------------------
            // DISPLAY MYSTERY CHARACTER
            // -------------------------------------------------

            mysteryCharacter.textContent =
                currentMystery.name;


            // -------------------------------------------------
            // DISPLAY ANSWER BUTTONS
            // -------------------------------------------------

            choices.innerHTML = "";


            candidateData.forEach(candidate => {

                const button =
                    document.createElement("button");


                button.type = "button";

                button.className =
                    "choice-button";


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


            // -------------------------------------------------
            // HIDE LOADING SCREEN
            // -------------------------------------------------

            loadingScreen.style.display =
                "none";


            console.log(
                "ROUND READY:",
                currentMystery.name
            );

        }

        catch (error) {

            showError(error);

        }

    }


    // =========================================================
    // HANDLE USER ANSWER
    // =========================================================

    function handleAnswer(
        selected,
        correct,
        mysteryVector
    ) {


        // Disable all buttons
        const buttons =
            choices.querySelectorAll(
                "button"
            );


        buttons.forEach(button => {

            button.disabled = true;


            // Highlight correct answer
            if (
                button.textContent ===
                correct.name
            ) {

                button.classList.add(
                    "correct"
                );

            }


            // Highlight wrong answer
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


        // -----------------------------------------------------
        // GET SHARED WORDS
        // -----------------------------------------------------

        const sharedWords =
            getSharedWords(
                mysteryVector,
                selected.vector
            );


        const isCorrect =
            selected.name ===
            correct.name;


        let html = "";


        // -----------------------------------------------------
        // RESULT MESSAGE
        // -----------------------------------------------------

        if (isCorrect) {

            html += `

                <div class="result-success">

                    <h3>
                        🎉 Correct!
                    </h3>

                    <p>
                        <strong>
                            ${selected.name}
                        </strong>

                        had the highest textual
                        similarity among the
                        four choices.
                    </p>

                </div>

            `;

        }

        else {

            html += `

                <div class="result-wrong">

                    <h3>
                        Not quite!
                    </h3>

                    <p>
                        The strongest textual match
                        was

                        <strong>
                            ${correct.name}
                        </strong>.
                    </p>

                </div>

            `;

        }


        // -----------------------------------------------------
        // SIMILARITY INFORMATION
        // -----------------------------------------------------

        html += `

            <div class="similarity-result">

                <p>
                    <strong>
                        Your choice similarity:
                    </strong>

                    ${selected.similarity.toFixed(3)}
                </p>


                <p>
                    <strong>
                        Best similarity:
                    </strong>

                    ${correct.similarity.toFixed(3)}
                </p>


                <p>
                    <strong>
                        Shared words:
                    </strong>

                    ${
                        sharedWords.length > 0
                        ? sharedWords.join(", ")
                        : "No strong shared words found."
                    }

                </p>


                <details>

                    <summary>
                        Inspect the underlying text
                    </summary>


                    <p>
                        The similarity score is
                        calculated from overlapping
                        words between the two
                        Wikipedia pages.
                    </p>


                    <p>
                        This game uses a
                        <strong>
                            Bag-of-Words
                        </strong>
                        representation and
                        cosine similarity.
                    </p>


                    <p>
                        Therefore, it does not
                        understand word order or
                        deeper semantic meaning.
                    </p>

                </details>

            </div>

        `;


        result.innerHTML =
            html;


        // Show next round button
        nextRound.style.display =
            "inline-block";

    }


    // =========================================================
    // SHOW ERROR
    // =========================================================

    function showError(error) {

        console.error(
            "GAME ERROR:",
            error
        );


        loadingScreen.style.display =
            "block";


        loading.innerHTML = `

            <div
                style="
                    color: #b00020;
                    padding: 20px;
                    text-align: center;
                "
            >

                <strong>
                    Game error
                </strong>

                <br><br>

                ${error.message}

            </div>

        `;

    }


    // =========================================================
    // NEXT ROUND BUTTON
    // =========================================================

    nextRound.addEventListener(
        "click",
        async function () {

            loadingScreen.style.display =
                "block";


            choices.innerHTML = "";


            status(
                "Preparing the next round..."
            );


            await createRound();

        }
    );


    // =========================================================
    // START GAME
    // =========================================================

    try {

        status(
            "Starting Marvel Text Detective..."
        );


        await loadDataset();


        await createRound();

    }

    catch (error) {

        showError(error);

    }

});
