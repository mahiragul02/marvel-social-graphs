document.addEventListener("DOMContentLoaded", () => {

    /* =========================
       GAME SETTINGS
    ========================= */

    const TOTAL_ROUNDS = 10;
    const STARTING_LIVES = 3;
    const ROUND_TIME = 30;

    /* =========================
       HTML ELEMENTS
    ========================= */

    const loadingScreen = document.getElementById("loading-screen");
    const loading = document.getElementById("loading");

    const startScreen = document.getElementById("start-screen");
    const startGameButton = document.getElementById("start-game");

    const finalScreen = document.getElementById("final-screen");
    const finalRank = document.getElementById("final-rank");
    const finalScore = document.getElementById("final-score");
    const finalCorrect = document.getElementById("final-correct");
    const finalRounds = document.getElementById("final-rounds");
    const finalStreak = document.getElementById("final-streak");
    const finalAccuracy = document.getElementById("final-accuracy");
    const playAgainButton = document.getElementById("play-again");

    const targetCharacter = document.getElementById("target-character");

    const choicesContainer = document.getElementById("choices");

    const scoreElement = document.getElementById("score");
    const livesElement = document.getElementById("lives");
    const streakElement = document.getElementById("streak");
    const timerElement = document.getElementById("timer");

    const roundLabel = document.getElementById("round-label");
    const progressFill = document.getElementById("progress-fill");

    const hintButton = document.getElementById("hint-button");
    const skipButton = document.getElementById("skip-button");
    const hintBox = document.getElementById("hint-box");

    const resultBox = document.getElementById("result");
    const nextRoundButton = document.getElementById("next-round");

    /* =========================
       GAME VARIABLES
    ========================= */

    let pages = [];

    let score = 0;
    let lives = STARTING_LIVES;
    let streak = 0;
    let bestStreak = 0;
    let correctAnswers = 0;

    let round = 1;

    let timeLeft = ROUND_TIME;
    let timerInterval = null;

    let answered = false;
    let hintUsed = false;
    let skipUsed = false;

    let currentMystery = null;
    let currentCorrect = null;
    let currentCandidates = [];

    /* =========================
       UTILITY FUNCTIONS
    ========================= */

    function shuffle(array) {
        const copied = [...array];

        for (let i = copied.length - 1; i > 0; i--) {

            const j = Math.floor(Math.random() * (i + 1));

            [copied[i], copied[j]] =
                [copied[j], copied[i]];
        }

        return copied;
    }

    function escapeHTML(text) {

        const div = document.createElement("div");

        div.textContent = text;

        return div.innerHTML;
    }

    function cleanCharacterName(filename) {

        let name = filename
            .replace(/\.(html|htm|txt)$/i, "")
            .replace(/[_-]+/g, " ")
            .trim();

        name = name.replace(/\s+/g, " ");

        return name;
    }

    /* =========================
       READ PAGE
    ========================= */

    async function readPage(page) {

        try {

            const content = await page.file.async("text");

            return content;

        } catch (error) {

            console.error("Could not read page:", page.name);

            return "";
        }
    }

    /* =========================
       BAG OF WORDS
    ========================= */

    function tokenize(text) {

        return text
            .toLowerCase()
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(word =>
                word.length > 2 &&
                word.length < 25
            );
    }

    function createVector(tokens) {

        const vector = {};

        tokens.forEach(word => {

            if (!vector[word]) {
                vector[word] = 0;
            }

            vector[word]++;
        });

        return vector;
    }

    /* =========================
       COSINE SIMILARITY
    ========================= */

    function cosineSimilarity(vectorA, vectorB) {

        const words = new Set([
            ...Object.keys(vectorA),
            ...Object.keys(vectorB)
        ]);

        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        words.forEach(word => {

            const a = vectorA[word] || 0;
            const b = vectorB[word] || 0;

            dotProduct += a * b;

            magnitudeA += a * a;
            magnitudeB += b * b;
        });

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dotProduct /
            (Math.sqrt(magnitudeA) *
             Math.sqrt(magnitudeB));
    }

    /* =========================
       UPDATE HUD
    ========================= */

    function updateHUD() {

        scoreElement.textContent = score;

        livesElement.textContent =
            "❤️".repeat(lives) +
            "🖤".repeat(STARTING_LIVES - lives);

        streakElement.textContent = streak;

        timerElement.textContent = timeLeft;

        roundLabel.textContent =
            `ROUND ${round} / ${TOTAL_ROUNDS}`;

        const progress =
            (round / TOTAL_ROUNDS) * 100;

        progressFill.style.width =
            `${progress}%`;
    }

    /* =========================
       TIMER
    ========================= */

    function stopTimer() {

        if (timerInterval) {

            clearInterval(timerInterval);

            timerInterval = null;
        }
    }

    function startTimer() {

        stopTimer();

        timeLeft = ROUND_TIME;

        updateHUD();

        timerInterval = setInterval(() => {

            if (answered) {
                return;
            }

            timeLeft--;

            updateHUD();

            if (timeLeft <= 0) {

                stopTimer();

                handleTimeOut();
            }

        }, 1000);
    }

    /* =========================
       CREATE ROUND
    ========================= */

    async function createRound() {

        stopTimer();

        answered = false;
        hintUsed = false;
        skipUsed = false;

        choicesContainer.innerHTML = "";

        resultBox.innerHTML = "";
        resultBox.style.display = "none";
        resultBox.className = "";

        hintBox.innerHTML = "";
        hintBox.style.display = "none";

        hintButton.disabled = false;
        skipButton.disabled = false;

        nextRoundButton.style.display = "none";

        updateHUD();

        /* Pick target character */

        const mysteryIndex =
            Math.floor(Math.random() * pages.length);

        currentMystery = pages[mysteryIndex];

        /* SHOW TARGET CHARACTER */

        targetCharacter.textContent =
            currentMystery.name;

        /* Select four different candidates */

        const availablePages =
            pages.filter((_, index) =>
                index !== mysteryIndex
            );

        const candidates =
            shuffle(availablePages).slice(0, 4);

        /* Read target page */

        const mysteryText =
            await readPage(currentMystery);

        const mysteryTokens =
            tokenize(mysteryText);

        const mysteryVector =
            createVector(mysteryTokens);

        /* Calculate similarities */

        const candidateData = [];

        for (const candidate of candidates) {

            const candidateText =
                await readPage(candidate);

            const candidateTokens =
                tokenize(candidateText);

            const candidateVector =
                createVector(candidateTokens);

            const similarity =
                cosineSimilarity(
                    mysteryVector,
                    candidateVector
                );

            candidateData.push({

                page: candidate,

                vector: candidateVector,

                similarity: similarity

            });
        }

        /* Highest similarity is correct answer */

        candidateData.sort(
            (a, b) =>
                b.similarity - a.similarity
        );

        currentCandidates = candidateData;

        currentCorrect =
            candidateData[0];

        /* Shuffle displayed choices */

        const displayedCandidates =
            shuffle(candidateData);

        displayedCandidates.forEach(candidateData => {

            const button =
                document.createElement("button");

            button.className =
                "choice-button";

            button.textContent =
                candidateData.page.name;

            button.dataset.name =
                candidateData.page.name;

            button.addEventListener(
                "click",
                () => {

                    handleAnswer(
                        candidateData,
                        button
                    );

                }
            );

            choicesContainer.appendChild(button);
        });

        startTimer();
    }

    /* =========================
       HANDLE ANSWER
    ========================= */

    function handleAnswer(selected, selectedButton) {

        if (answered) {
            return;
        }

        answered = true;

        stopTimer();

        /* Disable all choices */

        const allButtons =
            document.querySelectorAll(
                ".choice-button"
            );

        allButtons.forEach(button => {
            button.disabled = true;
        });

        const isCorrect =
            selected.page.name ===
            currentCorrect.page.name;

        /* =========================
           CORRECT
        ========================= */

        if (isCorrect) {

            selectedButton.classList.add(
                "correct"
            );

            correctAnswers++;

            streak++;

            if (streak > bestStreak) {
                bestStreak = streak;
            }

            let points =
                100 +
                (timeLeft * 3) +
                ((streak - 1) * 25);

            /* Hint penalty */

            if (hintUsed) {

                points =
                    Math.max(
                        25,
                        points - 40
                    );
            }

            score += points;

            resultBox.className =
                "result-correct";

            resultBox.innerHTML = `

                <div class="result-title">
                    ✓ CORRECT!
                </div>

                <div class="similarity">
                    Similarity:
                    ${(selected.similarity * 100).toFixed(1)}%
                </div>

                <div class="result-explanation">

                    <strong>
                        ${escapeHTML(selected.page.name)}
                    </strong>
                    has the highest textual similarity
                    to
                    <strong>
                        ${escapeHTML(currentMystery.name)}
                    </strong>.

                    <br><br>

                    The game compares the two Wikipedia
                    pages using a Bag-of-Words representation
                    and cosine similarity.

                    <br><br>

                    <strong>+${points} points</strong>

                </div>
            `;

        }

        /* =========================
           WRONG
        ========================= */

        else {

            selectedButton.classList.add(
                "wrong"
            );

            lives--;

            streak = 0;

            /* Highlight correct answer */

            allButtons.forEach(button => {

                if (
                    button.dataset.name ===
                    currentCorrect.page.name
                ) {

                    button.classList.add(
                        "correct"
                    );
                }

            });

            resultBox.className =
                "result-wrong";

            resultBox.innerHTML = `

                <div class="result-title">
                    ✕ WRONG ANSWER
                </div>

                <div class="similarity">

                    Correct answer:
                    ${escapeHTML(
                        currentCorrect.page.name
                    )}

                    <br>

                    Similarity:
                    ${(currentCorrect.similarity * 100).toFixed(1)}%

                </div>

                <div class="result-explanation">

                    Your selected character had a lower
                    textual similarity to
                    <strong>
                        ${escapeHTML(currentMystery.name)}
                    </strong>.

                    <br><br>

                    The correct character was the one
                    with the highest cosine similarity
                    between the two Wikipedia pages.

                </div>
            `;
        }

        updateHUD();

        resultBox.style.display = "block";

        hintButton.disabled = true;
        skipButton.disabled = true;

        /* Game over */

        if (lives <= 0) {

            setTimeout(() => {

                finishGame();

            }, 1800);

            return;
        }

        /* Last round */

        if (round >= TOTAL_ROUNDS) {

            nextRoundButton.textContent =
                "SEE RESULTS";

        }
        else {

            nextRoundButton.textContent =
                "NEXT ROUND →";
        }

        nextRoundButton.style.display =
            "block";
    }

    /* =========================
       TIME OUT
    ========================= */

    function handleTimeOut() {

        if (answered) {
            return;
        }

        answered = true;

        lives--;

        streak = 0;

        const allButtons =
            document.querySelectorAll(
                ".choice-button"
            );

        allButtons.forEach(button => {

            button.disabled = true;

            if (
                button.dataset.name ===
                currentCorrect.page.name
            ) {

                button.classList.add(
                    "correct"
                );
            }

        });

        resultBox.className =
            "result-wrong";

        resultBox.innerHTML = `

            <div class="result-title">
                ⏰ TIME'S UP!
            </div>

            <div class="similarity">

                Correct answer:
                ${escapeHTML(
                    currentCorrect.page.name
                )}

                <br>

                Similarity:
                ${(currentCorrect.similarity * 100).toFixed(1)}%

            </div>

            <div class="result-explanation">

                You ran out of time.

                <br><br>

                The correct answer was the character
                with the highest cosine similarity
                to
                <strong>
                    ${escapeHTML(currentMystery.name)}
                </strong>.

            </div>
        `;

        resultBox.style.display = "block";

        hintButton.disabled = true;
        skipButton.disabled = true;

        updateHUD();

        if (lives <= 0) {

            setTimeout(() => {

                finishGame();

            }, 1800);

            return;
        }

        if (round >= TOTAL_ROUNDS) {

            nextRoundButton.textContent =
                "SEE RESULTS";

        }
        else {

            nextRoundButton.textContent =
                "NEXT ROUND →";
        }

        nextRoundButton.style.display =
            "block";
    }

    /* =========================
       HINT
    ========================= */

    hintButton.addEventListener(
        "click",
        () => {

            if (
                answered ||
                hintUsed ||
                !currentCorrect
            ) {
                return;
            }

            hintUsed = true;

            hintButton.disabled = true;

            hintBox.style.display =
                "block";

            hintBox.innerHTML = `

                💡 <strong>HINT</strong>

                <br><br>

                Look for the character whose
                Wikipedia page is likely to discuss
                similar topics, relationships, or
                Marvel storylines as
                <strong>
                    ${escapeHTML(currentMystery.name)}
                </strong>.

                <br><br>

                ⚠️ Using a hint reduces your points
                for this round.

            `;
        }
    );

    /* =========================
       SKIP
    ========================= */

    skipButton.addEventListener(
        "click",
        () => {

            if (
                answered ||
                skipUsed
            ) {
                return;
            }

            skipUsed = true;

            answered = true;

            stopTimer();

            skipButton.disabled = true;
            hintButton.disabled = true;

            const allButtons =
                document.querySelectorAll(
                    ".choice-button"
                );

            allButtons.forEach(button => {

                button.disabled = true;

                if (
                    button.dataset.name ===
                    currentCorrect.page.name
                ) {

                    button.classList.add(
                        "correct"
                    );
                }

            });

            streak = 0;

            resultBox.className = "";

            resultBox.innerHTML = `

                <div class="result-title">
                    ⏭️ ROUND SKIPPED
                </div>

                <div class="similarity">

                    Correct answer:
                    ${escapeHTML(
                        currentCorrect.page.name
                    )}

                    <br>

                    Similarity:
                    ${(currentCorrect.similarity * 100).toFixed(1)}%

                </div>

                <div class="result-explanation">

                    No life was lost.

                    <br><br>

                    The correct character was the one
                    with the highest textual similarity
                    to
                    <strong>
                        ${escapeHTML(currentMystery.name)}
                    </strong>.

                </div>
            `;

            resultBox.style.display = "block";

            updateHUD();

            if (round >= TOTAL_ROUNDS) {

                nextRoundButton.textContent =
                    "SEE RESULTS";

            }
            else {

                nextRoundButton.textContent =
                    "NEXT ROUND →";
            }

            nextRoundButton.style.display =
                "block";
        }
    );

    /* =========================
       NEXT ROUND
    ========================= */

    nextRoundButton.addEventListener(
        "click",
        () => {

            if (round >= TOTAL_ROUNDS) {

                finishGame();

                return;
            }

            round++;

            createRound();
        }
    );

    /* =========================
       START GAME
    ========================= */

    startGameButton.addEventListener(
        "click",
        () => {

            startScreen.style.display =
                "none";

            score = 0;
            lives = STARTING_LIVES;
            streak = 0;
            bestStreak = 0;
            correctAnswers = 0;

            round = 1;

            updateHUD();

            createRound();
        }
    );

    /* =========================
       FINAL SCORE / RANK
    ========================= */

    function finishGame() {

        stopTimer();

        answered = true;

        const accuracy =
            round > 0
                ? Math.round(
                    (correctAnswers / round) * 100
                )
                : 0;

        let rank = "";

        if (score >= 1200) {

            rank =
                "MARVEL MASTER";

        }
        else if (score >= 850) {

            rank =
                "SUPER DETECTIVE";

        }
        else if (score >= 550) {

            rank =
                "ELITE AGENT";

        }
        else if (score >= 300) {

            rank =
                "FIELD DETECTIVE";

        }
        else {

            rank =
                "S.H.I.E.L.D. TRAINEE";
        }

        finalRank.textContent =
            rank;

        finalScore.textContent =
            score;

        finalCorrect.textContent =
            correctAnswers;

        finalRounds.textContent =
            Math.min(round, TOTAL_ROUNDS);

        finalStreak.textContent =
            bestStreak;

        finalAccuracy.textContent =
            `${accuracy}%`;

        finalScreen.style.display =
            "flex";
    }

    /* =========================
       PLAY AGAIN
    ========================= */

    playAgainButton.addEventListener(
        "click",
        () => {

            finalScreen.style.display =
                "none";

            score = 0;
            lives = STARTING_LIVES;
            streak = 0;
            bestStreak = 0;
            correctAnswers = 0;

            round = 1;

            updateHUD();

            createRound();
        }
    );

    /* =========================
       LOAD DATASET
    ========================= */

    async function loadDataset() {

        try {

            loading.textContent =
                "Loading Marvel Wikipedia dataset...";

            const response =
                await fetch("../marvel_pages.zip");

            if (!response.ok) {

                throw new Error(
                    "Could not load marvel_pages.zip"
                );
            }

            const zipData =
                await response.arrayBuffer();

            const zip =
                await JSZip.loadAsync(zipData);

            pages = [];

            zip.forEach((relativePath, file) => {

                if (file.dir) {
                    return;
                }

                const lower =
                    relativePath.toLowerCase();

                /* Only page files */

                const validExtension =
                    lower.endsWith(".html") ||
                    lower.endsWith(".htm") ||
                    lower.endsWith(".txt");

                if (!validExtension) {
                    return;
                }

                /* Ignore metadata files */

                if (
                    lower.includes("readme") ||
                    lower.includes("license") ||
                    lower.includes("metadata") ||
                    lower.includes(".git/")
                ) {
                    return;
                }

                const filename =
                    relativePath
                        .split("/")
                        .pop();

                if (!filename) {
                    return;
                }

                const name =
                    cleanCharacterName(
                        filename
                    );

                if (!name) {
                    return;
                }

                pages.push({

                    name: name,

                    filename: filename,

                    path: relativePath,

                    file: file

                });

            });

            console.log(
                `SUCCESS! ${pages.length} pages found.`
            );

            if (pages.length < 5) {

                throw new Error(
                    "Not enough Marvel pages were found in the dataset."
                );
            }

            loading.textContent =
                `Dataset ready — ${pages.length} characters found.`;

            setTimeout(() => {

                loadingScreen.style.display =
                    "none";

                startScreen.style.display =
                    "flex";

            }, 800);

        }

        catch (error) {

            console.error(error);

            loading.innerHTML = `

                <strong style="color:#ff4d52;">
                    Game error
                </strong>

                <br><br>

                ${escapeHTML(error.message)}

                <br><br>

                Make sure that
                <strong>
                    marvel_pages.zip
                </strong>
                is in the main project folder,
                one level above the
                <strong>week 5</strong> folder.

            `;
        }
    }

    /* =========================
       START LOADING
    ========================= */

    loadDataset();

});
