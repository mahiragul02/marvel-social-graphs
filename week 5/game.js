// ============================================================
// MARVEL TEXT DETECTIVE
// Week 5 - Social Graphs
// ============================================================

document.addEventListener("DOMContentLoaded", function () {

    const loading = document.getElementById("loading");
    const mysteryCharacter =
        document.getElementById("mystery-character");
    const choices =
        document.getElementById("choices");
    const result =
        document.getElementById("result");
    const nextButton =
        document.getElementById("next-round");

    let characters = [];
    let pages = {};
    let vectors = {};
    let currentCharacter = null;
    let currentRound = 0;
    let score = 0;

    const TOTAL_ROUNDS = 5;


    // ========================================================
    // STOPWORDS
    // ========================================================

    const STOPWORDS = new Set([

        "the", "and", "for", "that", "with",
        "this", "from", "were", "was", "are",
        "his", "her", "their", "have", "has",
        "had", "not", "but", "which", "who",
        "into", "also", "been", "being", "they",
        "them", "than", "then", "when", "where",
        "about", "after", "before", "during",
        "while", "there", "these", "those",
        "more", "most", "other", "some",
        "such", "only", "very", "known",
        "will", "would", "could", "should",
        "may", "might", "can", "one", "two",
        "three", "first", "second", "new",
        "use", "used", "using"

    ]);


    // ========================================================
    // NORMALIZE NAMES
    // ========================================================

    function normalizeName(name) {

        return name
            .toLowerCase()
            .replace(/\.(html?|txt)$/i, "")
            .replace(/[_-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    }


    // ========================================================
    // CLEAN HTML
    // ========================================================

    function cleanText(text) {

        return text
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, " and ")
            .replace(/&#39;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/\s+/g, " ");

    }


    // ========================================================
    // BAG OF WORDS
    // ========================================================

    function makeVector(text) {

        const cleaned =
            cleanText(text)
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ");


        const words =
            cleaned
                .split(/\s+/)
                .filter(word =>
                    word.length >= 3 &&
                    !STOPWORDS.has(word)
                );


        const vector = {};

        for (const word of words) {

            vector[word] =
                (vector[word] || 0) + 1;

        }

        return vector;

    }


    // ========================================================
    // COSINE SIMILARITY
    // ========================================================

    function cosineSimilarity(a, b) {

        let dot = 0;
        let normA = 0;
        let normB = 0;


        for (const word in a) {

            normA +=
                a[word] * a[word];


            if (b[word]) {

                dot +=
                    a[word] * b[word];

            }

        }


        for (const word in b) {

            normB +=
                b[word] * b[word];

        }


        if (
            normA === 0 ||
            normB === 0
        ) {

            return 0;

        }


        return (
            dot /
            (
                Math.sqrt(normA) *
                Math.sqrt(normB)
            )
        );

    }


    // ========================================================
    // SHARED WORDS
    // ========================================================

    function getSharedWords(a, b) {

        const shared = [];


        for (const word in a) {

            if (
                b[word] &&
                !STOPWORDS.has(word)
            ) {

                shared.push({

                    word: word,

                    score:
                        a[word] *
                        b[word]

                });

            }

        }


        shared.sort(
            (x, y) =>
                y.score - x.score
        );


        return shared
            .slice(0, 8)
            .map(x => x.word);

    }


    // ========================================================
    // LOAD TSV
    // ========================================================

    async function loadTSV(path) {

        const response =
            await fetch(path);


        if (!response.ok) {

            throw new Error(
                "Could not load " +
                path +
                " (" +
                response.status +
                ")"
            );

        }


        return await response.text();

    }


    // ========================================================
    // PARSE NODE FILE
    // ========================================================

    function parseNodes(text) {

        const lines =
            text
                .trim()
                .split(/\r?\n/);


        console.log(
            "Node header:",
            lines[0]
        );


        const header =
            lines[0]
                .split("\t")
                .map(x => x.trim().toLowerCase());


        let nameIndex =
            header.indexOf("name");


        if (nameIndex === -1) {

            nameIndex =
                header.indexOf("label");

        }


        if (nameIndex === -1) {

            nameIndex =
                header.indexOf("title");

        }


        if (nameIndex === -1) {

            // fallback:
            // find the first column containing text

            nameIndex = 0;

        }


        const result = [];


        for (
            let i = 1;
            i < lines.length;
            i++
        ) {

            const row =
                lines[i].split("\t");


            const name =
                row[nameIndex]
                    ?.trim();


            if (
                name &&
                name.length > 1
            ) {

                result.push(name);

            }

        }


        return [
            ...new Set(result)
        ];

    }


    // ========================================================
    // LOAD MARVEL PAGES
    // ========================================================

    async function loadPages() {

        loading.textContent =
            "Loading Marvel Wikipedia pages...";


        if (
            typeof JSZip === "undefined"
        ) {

            throw new Error(
                "JSZip is not available."
            );

        }


        const response =
            await fetch(
                "../marvel_pages.zip"
            );


        if (!response.ok) {

            throw new Error(
                "Could not load marvel_pages.zip"
            );

        }


        const buffer =
            await response.arrayBuffer();


        const zip =
            await JSZip.loadAsync(buffer);


        const filenames =
            Object.keys(zip.files);


        console.log(
            "Total ZIP entries:",
            filenames.length
        );


        // ----------------------------------------------------
        // IMPORTANT:
        // ONLY USE ACTUAL PAGE FILES
        // IGNORE README, folders, metadata, etc.
        // ----------------------------------------------------

        const pageFiles =
            filenames.filter(filename => {

                const file =
                    zip.files[filename];


                if (file.dir) {
                    return false;
                }


                const lower =
                    filename.toLowerCase();


                // Ignore README and metadata
                if (
                    lower.includes("readme") ||
                    lower.includes("license") ||
                    lower.includes("metadata") ||
                    lower.includes(".git")
                ) {

                    return false;

                }


                // Only page-like files
                return (
                    lower.endsWith(".html") ||
                    lower.endsWith(".htm") ||
                    lower.endsWith(".txt")
                );

            });


        console.log(
            "Potential Marvel pages:",
            pageFiles.length
        );


        if (pageFiles.length === 0) {

            throw new Error(
                "No Marvel page files were found in the ZIP."
            );

        }


        pages = {};


        for (const filename of pageFiles) {

            const file =
                zip.files[filename];


            const text =
                await file.async("text");


            const baseName =
                filename
                    .split("/")
                    .pop();


            const characterName =
                baseName
                    .replace(/\.(html?|txt)$/i, "")
                    .replace(/[_-]/g, " ")
                    .trim();


            // Ignore suspicious generic files
            if (
                !characterName ||
                characterName.length < 2
            ) {

                continue;

            }


            const key =
                normalizeName(characterName);


            pages[key] = {

                name: characterName,

                text: text

            };

        }


        console.log(
            "Indexed Marvel pages:",
            Object.keys(pages).length
        );

    }


    // ========================================================
    // MATCH CHARACTERS TO PAGES
    // ========================================================

    function buildVectors() {

        vectors = {};

        let matched = 0;


        for (const character of characters) {

            const key =
                normalizeName(character);


            let page =
                pages[key];


            // Exact match
            if (!page) {

                // Try removing common prefixes
                const possibleKeys =
                    Object.keys(pages);


                const match =
                    possibleKeys.find(
                        pageKey =>
                            pageKey === key
                    );


                if (match) {
                    page = pages[match];
                }

            }


            if (page) {

                const vector =
                    makeVector(page.text);


                // Make sure this is real text
                if (
                    Object.keys(vector).length > 0
                ) {

                    vectors[character] =
                        vector;

                    matched++;

                }

            }

        }


        console.log(
            "Characters:",
            characters.length
        );


        console.log(
            "Characters with text:",
            matched
        );


        if (matched < 10) {

            console.warn(
                "Only " +
                matched +
                " pages matched."
            );

        }

    }


    // ========================================================
    // PICK RANDOM CHARACTER
    // ========================================================

    function randomCharacter() {

        const available =
            Object.keys(vectors);


        if (available.length === 0) {

            throw new Error(
                "No characters with usable text were found."
            );

        }


        return available[
            Math.floor(
                Math.random() *
                available.length
            )
        ];

    }


    // ========================================================
    // FIND SIMILAR CHARACTERS
    // ========================================================

    function getSimilarCharacters(target) {

        const results = [];


        for (const character of Object.keys(vectors)) {

            if (character === target) {
                continue;
            }


            const similarity =
                cosineSimilarity(
                    vectors[target],
                    vectors[character]
                );


            results.push({

                name: character,

                similarity: similarity

            });

        }


        results.sort(
            (a, b) =>
                b.similarity -
                a.similarity
        );


        return results;

    }


    // ========================================================
    // CREATE ROUND
    // ========================================================

    function createRound() {

        result.innerHTML = "";

        nextButton.style.display = "none";


        currentCharacter =
            randomCharacter();


        const similar =
            getSimilarCharacters(
                currentCharacter
            );


        console.log(
            "Mystery character:",
            currentCharacter
        );


        console.log(
            "Best text matches:",
            similar.slice(0, 5)
        );


        // ----------------------------------------------------
        // We deliberately use the real character's
        // strongest textual matches as choices.
        // This makes the game meaningful.
        // ----------------------------------------------------

        const candidates =
            similar.slice(0, 3);


        const options = [

            {
                name: currentCharacter,
                correct: true,
                similarity: 1
            },

            ...candidates.map(item => ({

                name: item.name,

                correct: false,

                similarity:
                    cosineSimilarity(
                        vectors[currentCharacter],
                        vectors[item.name]
                    )

            }))

        ];


        // Shuffle
        options.sort(
            () => Math.random() - 0.5
        );


        mysteryCharacter.textContent =
            "Which Marvel character is this page most similar to?";


        choices.innerHTML = "";


        options.forEach(option => {

            const button =
                document.createElement("button");


            button.type = "button";


            button.className =
                "choice-button";


            button.textContent =
                option.name;


            button.addEventListener(
                "click",
                function () {

                    handleAnswer(
                        option,
                        options
                    );

                }
            );


            choices.appendChild(button);

        });

    }


    // ========================================================
    // HANDLE ANSWER
    // ========================================================

    function handleAnswer(
        selected,
        options
    ) {

        const buttons =
            choices.querySelectorAll(
                "button"
            );


        buttons.forEach(
            button =>
                button.disabled = true
        );


        const similarity =
            selected.similarity;


        if (selected.correct) {

            score++;

        }


        // Highlight
        buttons.forEach(button => {

            if (
                button.textContent ===
                currentCharacter
            ) {

                button.style.border =
                    "3px solid #16a34a";

            }


            if (
                button.textContent ===
                selected.name &&
                !selected.correct
            ) {

                button.style.border =
                    "3px solid #dc2626";

            }

        });


        // ----------------------------------------------------
        // Shared words
        // ----------------------------------------------------

        const sharedWords =
            getSharedWords(
                vectors[currentCharacter],
                vectors[selected.name]
            );


        // ----------------------------------------------------
        // SCORE
        // ----------------------------------------------------

        let html = "";


        if (selected.correct) {

            html +=
                "<h3>Correct! 🎉</h3>";

        } else {

            html +=
                "<h3>Not quite.</h3>";

        }


        html +=
            "<p><strong>Character:</strong> " +
            currentCharacter +
            "</p>";


        html +=
            "<p><strong>Your answer:</strong> " +
            selected.name +
            "</p>";


        html +=
            "<p><strong>Textual similarity:</strong> " +
            similarity.toFixed(3) +
            "</p>";


        if (sharedWords.length > 0) {

            html +=
                "<p><strong>Shared words:</strong> " +
                sharedWords.join(", ") +
                "</p>";

        } else {

            html +=
                "<p><strong>Shared words:</strong> " +
                "No strong shared words found.</p>";

        }


        html +=
            "<p class='small-note'>" +
            "Similarity is calculated using a Bag-of-Words " +
            "representation and cosine similarity. " +
            "It measures word overlap, not deeper meaning." +
            "</p>";


        result.innerHTML =
            html;


        currentRound++;


        if (
            currentRound < TOTAL_ROUNDS
        ) {

            nextButton.textContent =
                "Next Mystery Character";


            nextButton.style.display =
                "inline-block";


        } else {

            nextButton.textContent =
                "Play Again";


            nextButton.style.display =
                "inline-block";


            result.innerHTML +=
                "<hr><h3>Final score: " +
                score +
                " / " +
                TOTAL_ROUNDS +
                "</h3>";

        }

    }


    // ========================================================
    // NEXT ROUND
    // ========================================================

    nextButton.addEventListener(
        "click",
        function () {

            if (
                currentRound >= TOTAL_ROUNDS
            ) {

                currentRound = 0;
                score = 0;

            }


            createRound();

        }
    );


    // ========================================================
    // START GAME
    // ========================================================

    async function startGame() {

        try {

            loading.textContent =
                "Loading Marvel characters...";


            const nodeText =
                await loadTSV(
                    "../week1_nodes.tsv"
                );


            characters =
                parseNodes(nodeText);


            console.log(
                "Loaded characters:",
                characters
            );


            await loadPages();


            loading.textContent =
                "Matching Marvel pages...";


            buildVectors();


            console.log(
                "Usable characters:",
                Object.keys(vectors)
            );


            loading.style.display =
                "none";


            createRound();

        }

        catch (error) {

            console.error(
                "MARVEL GAME ERROR:",
                error
            );


            loading.textContent =
                "Game error: " +
                error.message;

        }

    }


    startGame();

});
