document.addEventListener("DOMContentLoaded", async function () {

    const loadingScreen =
        document.getElementById("loading-screen");

    const loading =
        document.getElementById("loading");

    const mysteryCharacter =
        document.getElementById("mystery-character");

    const choices =
        document.getElementById("choices");

    const result =
        document.getElementById("result");

    const nextRound =
        document.getElementById("next-round");


    // =====================================================
    // VARIABLES
    // =====================================================

    let characters = [];
    let pages = {};

    let mysteryName = "";
    let mysteryText = "";

    let currentCandidates = [];


    // =====================================================
    // STATUS
    // =====================================================

    function status(message) {

        console.log(message);

        if (loading) {
            loading.textContent = message;
        }
    }


    // =====================================================
    // NORMALIZE NAME
    // =====================================================

    function normalizeName(name) {

        return String(name || "")
            .toLowerCase()
            .replace(/\.(html?|txt)$/i, "")
            .replace(/[_-]+/g, " ")
            .replace(/[^\w\s]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }


    // =====================================================
    // CLEAN TEXT
    // =====================================================

    function cleanText(text) {

        return String(text || "")
            .replace(
                /<script[\s\S]*?<\/script>/gi,
                " "
            )
            .replace(
                /<style[\s\S]*?<\/style>/gi,
                " "
            )
            .replace(
                /<[^>]+>/g,
                " "
            )
            .replace(
                /&nbsp;/gi,
                " "
            )
            .replace(
                /&amp;/gi,
                "&"
            )
            .toLowerCase()
            .replace(
                /[^a-z\s]/g,
                " "
            )
            .split(/\s+/)
            .filter(word =>
                word.length >= 3
            );
    }


    // =====================================================
    // BAG OF WORDS
    // =====================================================

    function makeVector(text) {

        const words =
            cleanText(text);

        const vector = {};

        words.forEach(word => {

            vector[word] =
                (vector[word] || 0) + 1;

        });

        return vector;
    }


    // =====================================================
    // COSINE SIMILARITY
    // =====================================================

    function cosineSimilarity(a, b) {

        const words =
            new Set([
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

        if (
            magnitudeA === 0 ||
            magnitudeB === 0
        ) {
            return 0;
        }

        return dot /
            (
                Math.sqrt(magnitudeA) *
                Math.sqrt(magnitudeB)
            );
    }


    // =====================================================
    // SHARED WORDS
    // =====================================================

    function getSharedWords(a, b) {

        return Object.keys(a)
            .filter(word => b[word])
            .sort((x, y) =>
                (a[y] + b[y]) -
                (a[x] + b[x])
            )
            .slice(0, 10);
    }


    // =====================================================
    // LOAD CHARACTERS
    // =====================================================

    async function loadCharacters() {

        status(
            "Loading Marvel character list..."
        );

        const response =
            await fetch(
                "../week1_nodes.tsv"
            );

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
                .filter(line =>
                    line.trim()
                );

        const headers =
            lines[0]
                .split("\t")
                .map(header =>
                    header
                        .trim()
                        .toLowerCase()
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
                "Could not find character name column."
            );
        }

        characters = [];

        for (
            let i = 1;
            i < lines.length;
            i++
        ) {

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


    // =====================================================
    // LOAD ZIP
    // =====================================================

    async function loadPages() {

        status(
            "Loading Marvel Wikipedia dataset..."
        );

        const response =
            await fetch(
                "../marvel_pages.zip"
            );

        if (!response.ok) {

            throw new Error(
                "Could not load marvel_pages.zip"
            );
        }

        status(
            "Opening Marvel Wikipedia dataset..."
        );

        const buffer =
            await response.arrayBuffer();

        const zip =
            await JSZip.loadAsync(buffer);

        const filenames =
            Object.keys(zip.files)
                .filter(filename => {

                    const lower =
                        filename.toLowerCase();

                    if (
                        zip.files[filename].dir
                    ) {
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

        status(
            "Found " +
            filenames.length +
            " Marvel pages. Reading text..."
        );


        // Read pages in parallel

        const loaded =
            await Promise.all(
                filenames.map(
                    async filename => {

                        try {

                            const text =
                                await zip
                                    .files[filename]
                                    .async("text");

                            const shortName =
                                filename
                                    .split("/")
                                    .pop();

                            return {
                                key:
                                    normalizeName(
                                        shortName
                                    ),
                                text: text
                            };

                        } catch (error) {

                            console.warn(
                                "Could not read:",
                                filename
                            );

                            return null;
                        }
                    }
                )
            );


        pages = {};

        loaded.forEach(page => {

            if (!page) return;

            if (!pages[page.key]) {

                pages[page.key] =
                    page.text;
            }

        });


        console.log(
            "Pages loaded:",
            Object.keys(pages).length
        );
    }


    // =====================================================
    // FIND PAGE
    // =====================================================

    function findPage(name) {

        const target =
            normalizeName(name);

        // Exact match

        if (pages[target]) {
            return pages[target];
        }


        // Partial match

        const keys =
            Object.keys(pages);

        for (const key of keys) {

            if (
                key === target ||
                key.includes(target) ||
                target.includes(key)
            ) {

                return pages[key];
            }
        }

        return "";
    }


    // =====================================================
    // RANDOM CHARACTERS
    // =====================================================

    function getRandomCharacters(
        number,
        exclude = []
    ) {

        const available =
            characters.filter(
                name =>
                    !exclude.includes(name) &&
                    findPage(name)
            );

        const shuffled =
            [...available].sort(
                () => Math.random() - 0.5
            );

        return shuffled.slice(
            0,
            number
        );
    }


    // =====================================================
    // CREATE ROUND
    // =====================================================

    async function createRound() {

        status(
            "Preparing a new mystery character..."
        );

        result.innerHTML = "";

        choices.innerHTML = "";

        nextRound.style.display =
            "none";


        // Pick mystery character

        const mysteries =
            characters.filter(
                name =>
                    findPage(name)
            );

        if (mysteries.length === 0) {

            throw new Error(
                "No character pages could be matched."
            );
        }


        mysteryName =
            mysteries[
                Math.floor(
                    Math.random() *
                    mysteries.length
                )
            ];


        mysteryText =
            findPage(mysteryName);


        mysteryCharacter.textContent =
            mysteryName;


        status(
            "Selecting four possible characters..."
        );


        currentCandidates =
            getRandomCharacters(
                4,
                [mysteryName]
            );


        if (
            currentCandidates.length < 4
        ) {

            throw new Error(
                "Could not find four candidate characters."
            );
        }


        status(
            "Calculating textual similarity..."
        );


        const mysteryVector =
            makeVector(
                mysteryText
            );


        const scored =
            currentCandidates.map(
                name => {

                    const text =
                        findPage(name);

                    const vector =
                        makeVector(text);

                    const similarity =
                        cosineSimilarity(
                            mysteryVector,
                            vector
                        );

                    return {
                        name: name,
                        text: text,
                        vector: vector,
                        similarity:
                            similarity
                    };
                }
            );


        // Highest score = textual answer

        scored.sort(
            (a, b) =>
                b.similarity -
                a.similarity
        );


        currentCandidates =
            scored;


        // =================================================
        // DISPLAY BUTTONS
        // =================================================

        choices.innerHTML = "";

        scored.forEach(candidate => {

            const button =
                document.createElement(
                    "button"
                );

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
                        scored[0]
                    );

                }
            );


            choices.appendChild(
                button
            );

        });


        // Hide loading

        if (loadingScreen) {

            loadingScreen.style.display =
                "none";
        }

        console.log(
            "Round ready."
        );
    }


    // =====================================================
    // HANDLE ANSWER
    // =====================================================

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
            getSharedWords(
                makeVector(mysteryText),
                selected.vector
            );


        const isCorrect =
            selected.name ===
            correct.name;


        let html = "";


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
                        similarity among the four choices.
                    </p>

                </div>
            `;

        } else {

            html += `
                <div class="result-wrong">

                    <h3>
                        Not quite!
                    </h3>

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
                        words.length
                            ? words.join(", ")
                            : "No strong shared words found."
                    }
                </p>


                <details>

                    <summary>
                        Inspect the underlying text
                    </summary>

                    <p>
                        The similarity score is based on
                        overlapping words between the two
                        Wikipedia pages.
                    </p>

                    <p>
                        This is a Bag-of-Words approach,
                        so it does not understand word order
                        or deeper semantic meaning.
                    </p>

                </details>

            </div>
        `;


        result.innerHTML =
            html;


        nextRound.style.display =
            "inline-block";
    }


    // =====================================================
    // NEXT ROUND
    // =====================================================

    nextRound.addEventListener(
        "click",
        async function () {

            try {

                if (loadingScreen) {

                    loadingScreen.style.display =
                        "block";
                }

                await createRound();

            } catch (error) {

                showError(error);
            }

        }
    );


    // =====================================================
    // ERROR
    // =====================================================

    function showError(error) {

        console.error(
            "GAME ERROR:",
            error
        );

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
                        Game error
                    </strong>

                    <br><br>

                    ${error.message}

                </div>
            `;
        }
    }


    // =====================================================
    // START GAME
    // =====================================================

    try {

        status(
            "Starting Marvel Text Detective..."
        );

        await loadCharacters();

        await loadPages();

        await createRound();

    } catch (error) {

        showError(error);
    }

});
