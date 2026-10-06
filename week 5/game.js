```javascript
// ============================================================
// MARVEL TEXT DETECTIVE
// DTU Social Graphs - Week 5
// ============================================================

document.addEventListener("DOMContentLoaded", function () {

    // --------------------------------------------------------
    // HTML ELEMENTS
    // --------------------------------------------------------

    const loading =
        document.getElementById("loading");

    const mysteryCharacter =
        document.getElementById("mystery-character");

    const choices =
        document.getElementById("choices");

    const result =
        document.getElementById("result");

    const nextButton =
        document.getElementById("next-round");


    // --------------------------------------------------------
    // GAME VARIABLES
    // --------------------------------------------------------

    let characters = [];

    let pages = {};

    let vectors = {};

    let currentCharacter = null;

    let currentRound = 0;

    let score = 0;

    const TOTAL_ROUNDS = 5;


    // --------------------------------------------------------
    // CHECK REQUIRED HTML ELEMENTS
    // --------------------------------------------------------

    if (!loading) {
        console.error("Element #loading was not found.");
        return;
    }

    if (!mysteryCharacter) {
        loading.textContent =
            "Game error: #mystery-character is missing.";
        return;
    }

    if (!choices) {
        loading.textContent =
            "Game error: #choices is missing.";
        return;
    }

    if (!result) {
        loading.textContent =
            "Game error: #result is missing.";
        return;
    }


    // ========================================================
    // STOPWORDS
    // ========================================================

    const STOPWORDS = new Set([

        "the",
        "and",
        "for",
        "that",
        "with",
        "this",
        "from",
        "were",
        "was",
        "are",
        "his",
        "her",
        "their",
        "have",
        "has",
        "had",
        "not",
        "but",
        "which",
        "who",
        "into",
        "also",
        "been",
        "being",
        "they",
        "them",
        "than",
        "then",
        "when",
        "where",
        "about",
        "after",
        "before",
        "during",
        "while",
        "there",
        "these",
        "those",
        "more",
        "most",
        "other",
        "some",
        "such",
        "only",
        "very",
        "known",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "can",
        "one",
        "two",
        "three",
        "first",
        "second",
        "new",
        "use",
        "used",
        "using",
        "page",
        "pages",
        "article",
        "articles",
        "wikipedia"

    ]);


    // ========================================================
    // NORMALIZE NAMES
    // ========================================================

    function normalizeName(name) {

        return String(name)
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

        return String(text)
            .replace(
                /<script[\s\S]*?<\/script>/gi,
                " "
            )
            .replace(
                /<style[\s\S]*?<\/style>/gi,
                " "
            )
            .replace(
                /<[^>]*>/g,
                " "
            )
            .replace(
                /&nbsp;/gi,
                " "
            )
            .replace(
                /&amp;/gi,
                " and "
            )
            .replace(
                /&#39;/gi,
                "'"
            )
            .replace(
                /&quot;/gi,
                '"'
            )
            .replace(
                /\s+/g,
                " ");

    }


    // ========================================================
    // BAG OF WORDS
    // ========================================================

    function makeVector(text) {

        const cleaned =
            cleanText(text)
                .toLowerCase()
                .replace(
                    /[^a-z0-9\s]/g,
                    " "
                );


        const words =
            cleaned
                .split(/\s+/)
                .filter(function (word) {

                    return (
                        word.length >= 3 &&
                        !STOPWORDS.has(word)
                    );

                });


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
    // GET SHARED WORDS
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
                        a[word] * b[word]

                });

            }

        }


        shared.sort(function (x, y) {

            return y.score - x.score;

        });


        return shared
            .slice(0, 8)
            .map(function (item) {

                return item.word;

            });

    }


    // ========================================================
    // LOAD TEXT FILE
    // ========================================================

    async function loadTextFile(path) {

        const response =
            await fetch(path);


        if (!response.ok) {

            throw new Error(
                "Could not load " +
                path +
                " (HTTP " +
                response.status +
                ")"
            );

        }


        return await response.text();

    }


    // ========================================================
    // LOAD CHARACTERS FROM week1_nodes.tsv
    // ========================================================

    function parseCharacters(text) {

        const lines =
            text
                .trim()
                .split(/\r?\n/);


        if (lines.length < 2) {

            throw new Error(
                "week1_nodes.tsv contains no character data."
            );

        }


        const header =
            lines[0]
                .split("\t")
                .map(function (value) {

                    return value
                        .trim()
                        .toLowerCase();

                });


        console.log(
            "Node file header:",
            header
        );


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

            throw new Error(
                "Could not find a name/label column in week1_nodes.tsv."
            );

        }


        const names = [];


        for (
            let i = 1;
            i < lines.length;
            i++
        ) {

            const row =
                lines[i].split("\t");


            const name =
                row[nameIndex]
                    ? row[nameIndex].trim()
                    : "";


            if (
                name &&
                name.length > 1 &&
                !names.includes(name)
            ) {

                names.push(name);

            }

        }


        return names;

    }


    // ========================================================
    // LOAD MARVEL ZIP
    // ========================================================

    async function loadMarvelPages() {

        loading.textContent =
            "Loading Marvel Wikipedia pages...";


        if (
            typeof JSZip === "undefined"
        ) {

            throw new Error(
                "JSZip is not available. Check the JSZip script in index.html."
            );

        }


        const response =
            await fetch(
                "../marvel_pages.zip"
            );


        if (!response.ok) {

            throw new Error(
                "Could not load marvel_pages.zip " +
                "(HTTP " +
                response.status +
                ")."
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


        pages = {};


        // ----------------------------------------------------
        // ONLY USE ACTUAL HTML/TXT FILES
        // IGNORE README, LICENSE, FOLDERS, ETC.
        // ----------------------------------------------------

        const pageFiles =
            filenames.filter(function (filename) {

                const file =
                    zip.files[filename];


                if (file.dir) {
                    return false;
                }


                const lower =
                    filename.toLowerCase();


                if (
                    lower.includes("readme") ||
                    lower.includes("license") ||
                    lower.includes("metadata") ||
                    lower.includes(".git")
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
            "Possible Marvel page files:",
            pageFiles.length
        );


        if (pageFiles.length === 0) {

            throw new Error(
                "No HTML or TXT Marvel pages were found inside marvel_pages.zip."
            );

        }


        // ----------------------------------------------------
        // READ EACH PAGE
        // ----------------------------------------------------

        for (
            const filename of pageFiles
        ) {

            const file =
                zip.files[filename];


            const text =
                await file.async("text");


            const filenameOnly =
                filename
                    .split("/")
                    .pop();


            const characterName =
                filenameOnly
                    .replace(
                        /\.(html?|txt)$/i,
                        ""
                    )
                    .replace(
                        /[_-]/g,
                        " "
                    )
                    .trim();


            if (!characterName) {
                continue;
            }


            const key =
                normalizeName(characterName);


            // Don't accidentally overwrite a real page
            // with another file having the same normalized name.

            if (!pages[key]) {

                pages[key] = {

                    name: characterName,

                    text: text

                };

            }

        }


        console.log(
            "Marvel pages indexed:",
            Object.keys(pages).length
        );

    }


    // ========================================================
    // MATCH CHARACTER NAMES TO PAGE TEXT
    // ========================================================

    function buildVectors() {

        vectors = {};


        let matched = 0;


        for (
            const character of characters
        ) {

            const key =
                normalizeName(character);


            let page =
                pages[key];


            // ------------------------------------------------
            // EXACT MATCH
            // ------------------------------------------------

            if (page) {

                const vector =
                    makeVector(page.text);


                if (
                    Object.keys(vector).length > 0
                ) {

                    vectors[character] =
                        vector;

                    matched++;

                }


                continue;

            }


            // ------------------------------------------------
            // PARTIAL MATCH
            // ------------------------------------------------

            const pageKeys =
                Object.keys(pages);


            const possible =
                pageKeys.find(function (pageKey) {

                    return (
                        pageKey === key ||
                        pageKey.includes(key) ||
                        key.includes(pageKey)
                    );

                });


            if (possible) {

                const vector =
                    makeVector(
                        pages[possible].text
                    );


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
            "Total characters:",
            characters.length
        );


        console.log(
            "Characters matched to pages:",
            matched
        );


        console.log(
            "Usable characters:",
            Object.keys(vectors)
        );


        if (matched < 4) {

            throw new Error(
                "Only " +
                matched +
                " characters could be matched to Wikipedia pages."
            );

        }

    }


    // ========================================================
    // GET SIMILAR CHARACTERS
    // ========================================================

    function getSimilarCharacters(target) {

        const results = [];


        for (
            const character of Object.keys(vectors)
        ) {

            if (
                character === target
            ) {

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


        results.sort(function (a, b) {

            return (
                b.similarity -
                a.similarity
            );

        });


        return results;

    }


    // ========================================================
    // SHUFFLE ARRAY
    // ========================================================

    function shuffle(array) {

        const result =
            [...array];


        for (
            let i = result.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() *
                    (i + 1)
                );


            [
                result[i],
                result[j]
            ] =
            [
                result[j],
                result[i]
            ];

        }


        return result;

    }


    // ========================================================
    // CREATE NEW ROUND
    // ========================================================

    function createRound() {

        result.innerHTML = "";

        nextButton.style.display =
            "none";


        const available =
            Object.keys(vectors);


        if (
            available.length < 4
        ) {

            throw new Error(
                "At least four usable Marvel characters are required."
            );

        }


        // Pick a mystery character
        currentCharacter =
            available[
                Math.floor(
                    Math.random() *
                    available.length
                )
            ];


        console.log(
            "Mystery character:",
            currentCharacter
        );


        // ----------------------------------------------------
        // IMPORTANT:
        // The mystery page itself is hidden.
        //
        // We select three other characters as possible answers.
        // One is the actual mystery character.
        // ----------------------------------------------------

        const similar =
            getSimilarCharacters(
                currentCharacter
            );


        // Take the three strongest text matches
        const alternatives =
            similar.slice(0, 3);


        const options = [

            {
                name: currentCharacter,

                correct: true,

                similarity: 1

            }

        ];


        alternatives.forEach(function (item) {

            options.push({

                name: item.name,

                correct: false,

                similarity:
                    item.similarity

            });

        });


        const shuffled =
            shuffle(options);


        // ----------------------------------------------------
        // DISPLAY MYSTERY
        // ----------------------------------------------------

        mysteryCharacter.innerHTML =
            "<strong>Mystery Character</strong><br>" +
            "Which Marvel character is described by this Wikipedia page?";


        choices.innerHTML = "";


        shuffled.forEach(function (option) {

            const button =
                document.createElement("button");


            button.type =
                "button";


            button.className =
                "choice-button";


            button.textContent =
                option.name;


            button.addEventListener(
                "click",
                function () {

                    handleAnswer(option);

                }
            );


            choices.appendChild(button);

        });

    }


    // ========================================================
    // HANDLE ANSWER
    // ========================================================

    function handleAnswer(selected) {

        const buttons =
            choices.querySelectorAll(
                "button"
            );


        buttons.forEach(function (button) {

            button.disabled = true;


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


        if (selected.correct) {

            score++;

        }


        const similarity =
            selected.correct
                ? 1
                : cosineSimilarity(
                    vectors[currentCharacter],
                    vectors[selected.name]
                );


        const sharedWords =
            selected.correct
                ? []
                : getSharedWords(
                    vectors[currentCharacter],
                    vectors[selected.name]
                );


        let html = "";


        if (selected.correct) {

            html +=
                "<h3>Correct! 🎉</h3>";

        } else {

            html +=
                "<h3>Not quite.</h3>";

        }


        html +=
            "<p><strong>Correct character:</strong> " +
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


        if (
            sharedWords.length > 0
        ) {

            html +=
                "<p><strong>Shared words:</strong> " +
                sharedWords.join(", ") +
                "</p>";

        }


        html +=
            "<p class='small-note'>" +
            "The score uses Bag-of-Words and cosine similarity. " +
            "It measures overlap in words rather than deeper semantic meaning." +
            "</p>";


        result.innerHTML =
            html;


        currentRound++;


        if (
            currentRound <
            TOTAL_ROUNDS
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
                "<hr>" +
                "<h3>Final score: " +
                score +
                " / " +
                TOTAL_ROUNDS +
                "</h3>";

        }

    }


    // ========================================================
    // NEXT BUTTON
    // ========================================================

    nextButton.addEventListener(
        "click",
        function () {

            if (
                currentRound >=
                TOTAL_ROUNDS
            ) {

                currentRound = 0;

                score = 0;

            }


            try {

                createRound();

            }

            catch (error) {

                showError(error);

            }

        }
    );


    // ========================================================
    // ERROR DISPLAY
    // ========================================================

    function showError(error) {

        console.error(
            "MARVEL TEXT DETECTIVE ERROR:",
            error
        );


        loading.style.display =
            "block";


        loading.innerHTML =
            "<strong>Game error:</strong><br>" +
            error.message +
            "<br><br>" +
            "<small>" +
            "Please check that week1_nodes.tsv and " +
            "marvel_pages.zip are in the repository root." +
            "</small>";

    }


    // ========================================================
    // START GAME
    // ========================================================

    async function startGame() {

        try {

            loading.style.display =
                "block";


            loading.textContent =
                "Loading Marvel characters...";


            // ------------------------------------------------
            // LOAD NODES
            // ------------------------------------------------

            const nodeText =
                await loadTextFile(
                    "../week1_nodes.tsv"
                );


            characters =
                parseCharacters(nodeText);


            console.log(
                "Loaded Marvel characters:",
                characters.length
            );


            if (
                characters.length < 4
            ) {

                throw new Error(
                    "Fewer than four Marvel characters were found."
                );

            }


            // ------------------------------------------------
            // LOAD PAGES
            // ------------------------------------------------

            await loadMarvelPages();


            // ------------------------------------------------
            // BUILD TEXT VECTORS
            // ------------------------------------------------

            loading.textContent =
                "Analysing Marvel Wikipedia pages...";


            buildVectors();


            // ------------------------------------------------
            // START
            // ------------------------------------------------

            loading.style.display =
                "none";


            createRound();

        }

        catch (error) {

            showError(error);

        }

    }


    // ========================================================
    // START
    // ========================================================

    startGame();

});
```
