// ============================================================
// MARVEL TEXT DETECTIVE
// Week 5 - Social Interactions and Graphs
// ============================================================

const ZIP_URL = "../marvel_pages.zip";
const NODES_URL = "../week1_nodes.tsv";
const EDGES_URL = "../week1_edges.tsv";

const STOPWORDS = new Set(`
a about above after again against all am an and any are as at be because been
before being below between both but by can could did do does doing down during
each few for from further had has have having he her here hers herself him
himself his how i if in into is it its itself just me more most my myself no
nor not of off on once only or other our ours ourselves out over own same she
should so some such than that the their theirs them themselves then there
these they this those through to too under until up very was we were what when
where which while who whom why will with would you your yours yourself yourselves
the page pages character characters marvel comics comic wikipedia wiki
`.trim().split(/\s+/));

let characters = [];
let pages = {};
let edges = [];
let currentRound = null;
let score = 0;
let roundNumber = 0;


// ============================================================
// UTILITY
// ============================================================

function normalizeName(name) {
    if (!name) return "";

    try {
        return decodeURIComponent(String(name))
            .replace(/_/g, " ")
            .replace(/\.(html?|txt)$/i, "")
            .trim()
            .toLowerCase();
    } catch {
        return String(name)
            .replace(/_/g, " ")
            .replace(/\.(html?|txt)$/i, "")
            .trim()
            .toLowerCase();
    }
}


function cleanText(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    doc.querySelectorAll(
        "script, style, nav, footer, header, table, svg, noscript"
    ).forEach(el => el.remove());

    return doc.body ? doc.body.innerText : "";
}


function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .map(w => w.replace(/^[-']+|[-']+$/g, ""))
        .filter(w =>
            w.length >= 3 &&
            !STOPWORDS.has(w) &&
            !/^\d+$/.test(w)
        );
}


function wordFrequency(tokens) {
    const counts = new Map();

    for (const word of tokens) {
        counts.set(word, (counts.get(word) || 0) + 1);
    }

    return counts;
}


function cosineSimilarity(freqA, freqB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const value of freqA.values()) {
        normA += value * value;
    }

    for (const value of freqB.values()) {
        normB += value * value;
    }

    for (const [word, value] of freqA.entries()) {
        if (freqB.has(word)) {
            dot += value * freqB.get(word);
        }
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}


function getSharedWords(freqA, freqB, limit = 8) {
    const shared = [];

    for (const [word, countA] of freqA.entries()) {
        if (freqB.has(word)) {
            shared.push({
                word,
                score: countA + freqB.get(word)
            });
        }
    }

    return shared
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => x.word);
}


function randomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
}


function shuffle(array) {
    return [...array].sort(() => Math.random() - 0.5);
}


// ============================================================
// TSV LOADING
// ============================================================

async function loadTSV(url) {

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Could not load ${url}`);
    }

    const text = await response.text();

    const lines = text
        .trim()
        .split(/\r?\n/)
        .filter(line => line.trim());

    if (!lines.length) {
        return [];
    }

    const headers = lines[0]
        .split("\t")
        .map(x => x.trim());

    return lines.slice(1).map(line => {

        const values = line.split("\t");
        const row = {};

        headers.forEach((header, i) => {
            row[header] = values[i] ?? "";
        });

        return row;
    });
}


// ============================================================
// LOAD MARVEL PAGES
// ============================================================

async function loadMarvelPages() {

    if (typeof JSZip === "undefined") {
        throw new Error(
            "JSZip was not loaded. Check the JSZip script in index.html."
        );
    }

    const response = await fetch(ZIP_URL);

    if (!response.ok) {
        throw new Error(
            `Could not load ${ZIP_URL}.`
        );
    }

    const blob = await response.blob();

    const zip = await JSZip.loadAsync(blob);

    const fileNames = Object.keys(zip.files);

    let loaded = 0;

    for (const fileName of fileNames) {

        const file = zip.files[fileName];

        if (file.dir) continue;

        if (!/\.(html?|txt)$/i.test(fileName)) {
            continue;
        }

        try {

            const html = await file.async("text");

            const clean = cleanText(html);

            if (clean.length <= 200) {
                continue;
            }

            const baseName =
                fileName.split("/").pop();

            const key =
                normalizeName(baseName);

            pages[key] = {

                name: baseName
                    .replace(/\.(html?|txt)$/i, "")
                    .replace(/_/g, " "),

                text: clean,

                tokens: tokenize(clean)
            };

            loaded++;

        } catch (error) {

            console.warn(
                "Could not read:",
                fileName,
                error
            );
        }
    }

    console.log(
        `Loaded ${loaded} Marvel pages.`
    );

    if (loaded === 0) {

        throw new Error(
            "No Marvel article pages were found inside marvel_pages.zip."
        );
    }
}


// ============================================================
// FIND PAGE
// ============================================================

function findPageForCharacter(name) {

    const normalized =
        normalizeName(name);

    if (pages[normalized]) {
        return pages[normalized];
    }

    const keys =
        Object.keys(pages);

    const exactPartial =
        keys.find(key =>
            key.includes(normalized) ||
            normalized.includes(key)
        );

    return exactPartial
        ? pages[exactPartial]
        : null;
}


// ============================================================
// NETWORK
// ============================================================

function getRowValue(row, possibleNames) {

    const keys =
        Object.keys(row);

    for (const possible of possibleNames) {

        const found =
            keys.find(
                key =>
                    key.toLowerCase() ===
                    possible.toLowerCase()
            );

        if (
            found &&
            row[found] !== undefined
        ) {
            return row[found];
        }
    }

    return null;
}


function buildNetwork(edgesData) {

    edges = edgesData
        .map(row => {

            const source =
                getRowValue(row, [
                    "source",
                    "from",
                    "src"
                ]);

            const target =
                getRowValue(row, [
                    "target",
                    "to",
                    "dst"
                ]);

            return {

                source:
                    normalizeName(source || ""),

                target:
                    normalizeName(target || "")
            };

        })
        .filter(
            e =>
                e.source &&
                e.target
        );
}


function areConnected(nameA, nameB) {

    const a =
        normalizeName(nameA);

    const b =
        normalizeName(nameB);

    return edges.some(e =>

        (e.source === a &&
         e.target === b)

        ||

        (e.source === b &&
         e.target === a)
    );
}


// ============================================================
// TEXT SIMILARITY
// ============================================================

function calculateSimilarities(targetName) {

    const targetPage =
        findPageForCharacter(targetName);

    if (!targetPage) {
        return [];
    }

    const targetFreq =
        wordFrequency(targetPage.tokens);

    const results = [];

    for (const key of Object.keys(pages)) {

        const candidate =
            pages[key];

        if (
            normalizeName(candidate.name) ===
            normalizeName(targetName)
        ) {
            continue;
        }

        const candidateFreq =
            wordFrequency(candidate.tokens);

        const similarity =
            cosineSimilarity(
                targetFreq,
                candidateFreq
            );

        results.push({

            name: candidate.name,

            similarity: similarity,

            sharedWords:
                getSharedWords(
                    targetFreq,
                    candidateFreq
                )
        });
    }

    return results.sort(
        (a, b) =>
            b.similarity -
            a.similarity
    );
}


// ============================================================
// CREATE ROUND
// ============================================================

function createRound() {

    if (characters.length < 4) {

        throw new Error(
            "Not enough Marvel characters were loaded."
        );
    }

    let attempts = 0;

    while (attempts < 50) {

        attempts++;

        const target =
            randomItem(characters);

        const similarities =
            calculateSimilarities(
                target.name
            );

        if (!similarities.length) {
            continue;
        }

        const correct =
            similarities[0];

        const possibleDistractors =
            characters.filter(c =>

                normalizeName(c.name) !==
                normalizeName(target.name)

                &&

                normalizeName(c.name) !==
                normalizeName(correct.name)
            );

        if (possibleDistractors.length < 3) {
            continue;
        }

        const distractors =
            shuffle(
                possibleDistractors
            ).slice(0, 3);

        const choices =
            shuffle([
                correct.name,
                ...distractors.map(
                    x => x.name
                )
            ]);

        currentRound = {

            target,

            correct,

            choices
        };

        roundNumber++;

        displayRound();

        return;
    }

    throw new Error(
        "Could not create a game round."
    );
}


// ============================================================
// DISPLAY ROUND
// ============================================================

function displayRound() {

    const targetElement =
        document.getElementById(
            "mystery-character"
        );

    const choicesElement =
        document.getElementById(
            "choices"
        );

    const resultElement =
        document.getElementById(
            "result"
        );

    const nextButton =
        document.getElementById(
            "next-round"
        );

    if (
        !targetElement ||
        !choicesElement ||
        !resultElement
    ) {

        throw new Error(
            "Game HTML elements are missing. Check index.html."
        );
    }

    targetElement.textContent =
        currentRound.target.name;

    choicesElement.innerHTML = "";

    currentRound.choices.forEach(
        name => {

            const button =
                document.createElement(
                    "button"
                );

            button.type = "button";

            button.className =
                "choice-button";

            button.textContent =
                name;

            button.disabled = false;

            button.addEventListener(
                "click",
                function () {

                    checkAnswer(
                        name,
                        button
                    );
                }
            );

            choicesElement.appendChild(
                button
            );
        }
    );

    resultElement.classList.add(
        "hidden"
    );

    if (nextButton) {

        nextButton.classList.add(
            "hidden"
        );

        nextButton.disabled = false;
    }

    const roundNumberElement =
        document.getElementById(
            "round-number"
        );

    const scoreElement =
        document.getElementById(
            "score"
        );

    if (roundNumberElement) {
        roundNumberElement.textContent =
            roundNumber;
    }

    if (scoreElement) {
        scoreElement.textContent =
            score;
    }
}


// ============================================================
// CHECK ANSWER
// ============================================================

function checkAnswer(
    answer,
    clickedButton
) {

    if (!currentRound) {
        return;
    }

    const buttons =
        document.querySelectorAll(
            ".choice-button"
        );

    buttons.forEach(
        button => {
            button.disabled = true;
        }
    );

    const correctName =
        currentRound.correct.name;

    const isCorrect =
        normalizeName(answer) ===
        normalizeName(correctName);

    if (isCorrect) {

        score++;

        clickedButton.classList.add(
            "correct"
        );

    } else {

        clickedButton.classList.add(
            "incorrect"
        );

        buttons.forEach(
            button => {

                if (
                    normalizeName(
                        button.textContent
                    ) ===
                    normalizeName(
                        correctName
                    )
                ) {

                    button.classList.add(
                        "correct"
                    );
                }
            }
        );
    }

    const scoreElement =
        document.getElementById(
            "score"
        );

    if (scoreElement) {
        scoreElement.textContent =
            score;
    }

    showResult(isCorrect);
}


// ============================================================
// SHOW RESULT
// ============================================================

function showResult(isCorrect) {

    const resultElement =
        document.getElementById(
            "result"
        );

    if (!resultElement) {
        return;
    }

    const targetPage =
        findPageForCharacter(
            currentRound.target.name
        );

    const matchPage =
        findPageForCharacter(
            currentRound.correct.name
        );

    const connected =
        areConnected(
            currentRound.target.name,
            currentRound.correct.name
        );

    const similarity =
        currentRound.correct.similarity;

    const sharedWords =
        currentRound.correct.sharedWords;

    const evidence =
        createEvidence(
            targetPage
                ? targetPage.text
                : "",

            matchPage
                ? matchPage.text
                : "",

            sharedWords
        );

    resultElement.innerHTML = `

        <div class="result-header ${
            isCorrect
                ? "success"
                : "failure"
        }">

            <div class="result-icon">
                ${
                    isCorrect
                        ? "✓"
                        : "!"
                }
            </div>

            <div>

                <h3>
                    ${
                        isCorrect
                            ? "Correct!"
                            : "Not quite!"
                    }
                </h3>

                <p>
                    The strongest textual match was
                    <strong>
                        ${escapeHTML(
                            currentRound
                                .correct
                                .name
                        )}
                    </strong>.
                </p>

            </div>

        </div>

        <div class="result-grid">

            <div class="result-card">

                <span class="result-label">
                    TEXTUAL SIMILARITY
                </span>

                <strong class="similarity-number">
                    ${similarity.toFixed(3)}
                </strong>

            </div>

            <div class="result-card">

                <span class="result-label">
                    NETWORK CONNECTION
                </span>

                <strong>
                    ${
                        connected
                            ? "✓ Directly connected"
                            : "✗ Not directly connected"
                    }
                </strong>

            </div>

        </div>

        <div class="evidence-section">

            <h4>
                Shared words
            </h4>

            <div class="word-list">

                ${
                    sharedWords
                        .map(
                            word =>
                                `<span>
                                    ${escapeHTML(word)}
                                </span>`
                        )
                        .join("")
                }

            </div>

        </div>

        <div class="evidence-section">

            <h4>
                🔎 Inspect the underlying text
            </h4>

            <p class="evidence-intro">
                The similarity score is only a clue.
                Here is actual text from the matched
                Marvel page containing one of the
                shared words.
            </p>

            <div class="quote-box">

                ${escapeHTML(evidence)}

            </div>

        </div>
    `;

    resultElement.classList.remove(
        "hidden"
    );

    const nextButton =
        document.getElementById(
            "next-round"
        );

    if (nextButton) {

        nextButton.classList.remove(
            "hidden"
        );

        nextButton.disabled = false;
    }
}


// ============================================================
// TEXT EVIDENCE
// ============================================================

function createEvidence(
    textA,
    textB,
    sharedWords
) {

    const sourceText =
        textB || textA;

    if (!sourceText) {
        return "No text evidence was available.";
    }

    const sentences =
        sourceText
            .replace(/\s+/g, " ")
            .split(/(?<=[.!?])\s+/);

    for (const word of sharedWords) {

        const sentence =
            sentences.find(
                sentence =>
                    sentence
                        .toLowerCase()
                        .includes(
                            word.toLowerCase()
                        )
            );

        if (
            sentence &&
            sentence.length > 50
        ) {

            return (
                sentence.substring(
                    0,
                    500
                ) +

                (
                    sentence.length > 500
                        ? "…"
                        : ""
                )
            );
        }
    }

    return sentences[0]
        ? sentences[0].substring(
            0,
            500
        )
        : "No text evidence was available.";
}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHTML(text) {

    return String(text)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


// ============================================================
// START GAME
// ============================================================

async function startGame() {

    const loading =
        document.getElementById(
            "loading"
        );

    try {

        if (!loading) {

            throw new Error(
                "The loading element is missing from index.html."
            );
        }

        loading.textContent =
            "Loading the Marvel Wikipedia pages…";

        await loadMarvelPages();

        loading.textContent =
            "Loading the Marvel network…";

        const nodesData =
            await loadTSV(
                NODES_URL
            );

        const edgesData =
            await loadTSV(
                EDGES_URL
            );

        buildNetwork(
            edgesData
        );

        characters =
            nodesData

                .map(row => {

                    const name =
                        getRowValue(
                            row,
                            [
                                "name",
                                "Name",
                                "label",
                                "Label",
                                "node",
                                "Node"
                            ]
                        );

                    return name
                        ? { name }
                        : null;
                })

                .filter(Boolean)

                .filter(
                    c =>
                        findPageForCharacter(
                            c.name
                        )
                );

        if (
            characters.length < 10
        ) {

            characters =
                Object.values(
                    pages
                ).map(
                    page => ({
                        name:
                            page.name
                    })
                );
        }

        if (
            characters.length < 4
        ) {

            throw new Error(
                `Only ${characters.length} usable Marvel characters were found.`
            );
        }

        loading.textContent =
            `${characters.length} Marvel pages loaded.`;

        setTimeout(() => {

            const loadingScreen =
                document.getElementById(
                    "loading-screen"
                );

            const gameContainer =
                document.getElementById(
                    "game-container"
                );

            if (loadingScreen) {

                loadingScreen.classList.add(
                    "hidden"
                );
            }

            if (gameContainer) {

                gameContainer.classList.remove(
                    "hidden"
                );
            }

            createRound();

        }, 500);

    } catch (error) {

        console.error(error);

        loading.innerHTML = `

            <strong>
                Something went wrong.
            </strong>

            <br><br>

            ${escapeHTML(
                error.message
            )}

            <br><br>

            Check that these files exist
            in the repository root:

            <br><br>

            <code>
                marvel_pages.zip
            </code>

            <br>

            <code>
                week1_nodes.tsv
            </code>

            <br>

            <code>
                week1_edges.tsv
            </code>
        `;
    }
}


// ============================================================
// NEXT ROUND
// ============================================================

document.addEventListener(
    "click",
    event => {

        if (
            event.target &&
            event.target.id ===
            "next-round"
        ) {

            createRound();
        }
    }
);


// ============================================================
// INITIALIZE
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    startGame
);
