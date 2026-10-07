document.addEventListener("DOMContentLoaded", () => {

    /* =========================================================
       MARVEL TEXT DETECTIVE
       WEEK 5
    ========================================================= */

    const TOTAL_ROUNDS = 10;
    const STARTING_LIVES = 3;
    const ROUND_TIME = 30;

    /* =========================================================
       HTML ELEMENTS
    ========================================================= */

    const loadingScreen =
        document.getElementById("loading-screen");

    const loading =
        document.getElementById("loading");

    const startScreen =
        document.getElementById("start-screen");

    const startGameButton =
        document.getElementById("start-game");

    const gameScreen =
        document.getElementById("game-screen");

    const finalScreen =
        document.getElementById("final-screen");

    const finalRank =
        document.getElementById("final-rank");

    const finalScore =
        document.getElementById("final-score");

    const finalCorrect =
        document.getElementById("final-correct");

    const finalRounds =
        document.getElementById("final-rounds");

    const finalStreak =
        document.getElementById("final-streak");

    const finalAccuracy =
        document.getElementById("final-accuracy");

    const playAgainButton =
        document.getElementById("play-again");

    const mysteryCharacter =
        document.getElementById("mystery-character");

    const choicesContainer =
        document.getElementById("choices");

    const scoreElement =
        document.getElementById("score");

    const livesElement =
        document.getElementById("lives");

    const streakElement =
        document.getElementById("streak");

    const timerElement =
        document.getElementById("timer");

    const roundLabel =
        document.getElementById("round-label");

    const progressFill =
        document.getElementById("progress-fill");

    const hintButton =
        document.getElementById("hint-button");

    const skipButton =
        document.getElementById("skip-button");

    const hintBox =
        document.getElementById("hint-box");

    const resultBox =
        document.getElementById("result");

    const nextRoundButton =
        document.getElementById("next-round");


    /* =========================================================
       CHECK HTML
    ========================================================= */

    const requiredElements = {
        loadingScreen,
        loading,
        startScreen,
        startGameButton,
        gameScreen,
        finalScreen,
        finalRank,
        finalScore,
        finalCorrect,
        finalRounds,
        finalStreak,
        finalAccuracy,
        playAgainButton,
        mysteryCharacter,
        choicesContainer,
        scoreElement,
        livesElement,
        streakElement,
        timerElement,
        roundLabel,
        progressFill,
        hintButton,
        skipButton,
        hintBox,
        resultBox,
        nextRoundButton
    };

    for (const [name, element] of Object.entries(requiredElements)) {

        if (!element) {

            console.error(
                `Text Detective: Missing HTML element: ${name}`
            );

        }

    }


    /* =========================================================
       GAME VARIABLES
    ========================================================= */

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


    /* =========================================================
       SHUFFLE
    ========================================================= */

    function shuffle(array) {

        const copied = [...array];

        for (
            let i = copied.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );

            [
                copied[i],
                copied[j]
            ] =
            [
                copied[j],
                copied[i]
            ];

        }

        return copied;
    }


    /* =========================================================
       ESCAPE HTML
    ========================================================= */

    function escapeHTML(text) {

        const div =
            document.createElement("div");

        div.textContent = text;

        return div.innerHTML;
    }


    /* =========================================================
       CLEAN CHARACTER NAME
    ========================================================= */

    function cleanCharacterName(filename) {

        let name =
            filename
                .replace(
                    /\.(html|htm|txt)$/i,
                    ""
                )
                .replace(
                    /[_-]+/g,
                    " "
                )
                .trim();

        name =
            name.replace(
                /\s+/g,
                " "
            );

        return name;
    }


    /* =========================================================
       READ PAGE
    ========================================================= */

    async function readPage(page) {

        try {

            return await page.file.async("text");

        }
        catch (error) {

            console.error(
                "Could not read page:",
                page.name
            );

            return "";

        }

    }


    /* =========================================================
       TOKENIZE
    ========================================================= */

    function tokenize(text) {

        return text
            .toLowerCase()

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
                /[^a-z0-9\s]/g,
                " "
            )

            .split(/\s+/)

            .filter(
                word =>
                    word.length > 2 &&
                    word.length < 25
            );

    }


    /* =========================================================
       CREATE WORD VECTOR
    ========================================================= */

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


    /* =========================================================
       COSINE SIMILARITY
    ========================================================= */

    function cosineSimilarity(
        vectorA,
        vectorB
    ) {

        const words =
            new Set([
                ...Object.keys(vectorA),
                ...Object.keys(vectorB)
            ]);

        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        words.forEach(word => {

            const a =
                vectorA[word] || 0;

            const b =
                vectorB[word] || 0;

            dotProduct +=
                a * b;

            magnitudeA +=
                a * a;

            magnitudeB +=
                b * b;

        });


        if (
            magnitudeA === 0 ||
            magnitudeB === 0
        ) {

            return 0;

        }


        return (
            dotProduct /
            (
                Math.sqrt(magnitudeA) *
                Math.sqrt(magnitudeB)
            )
        );

    }


    /* =========================================================
       UPDATE HUD
    ========================================================= */

    function updateHUD() {

        scoreElement.textContent =
            score;

        livesElement.textContent =
            "❤️".repeat(lives) +
            "🖤".repeat(
                STARTING_LIVES - lives
            );

        streakElement.textContent =
            streak;

        timerElement.textContent =
            timeLeft;

        roundLabel.textContent =
            `ROUND ${round} / ${TOTAL_ROUNDS}`;

        const progress =
            (round / TOTAL_ROUNDS) * 100;

        progressFill.style.width =
            `${progress}%`;

    }


    /* =========================================================
       TIMER
    ========================================================= */

    function stopTimer() {

        if (timerInterval) {

            clearInterval(
                timerInterval
            );

            timerInterval = null;

        }

    }


    function startTimer() {

        stopTimer();

        timeLeft =
            ROUND_TIME;

        updateHUD();

        timerInterval =
            setInterval(() => {

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


    /* =========================================================
       CREATE ROUND
    ========================================================= */

    async function createRound() {

        try {

            stopTimer();

            answered = false;

            hintUsed = false;

            skipUsed = false;


            choicesContainer.innerHTML = "";

            resultBox.innerHTML = "";

            resultBox.style.display =
                "none";

            resultBox.className = "";


            hintBox.innerHTML = "";

            hintBox.style.display =
                "none";


            hintButton.disabled =
                false;

            skipButton.disabled =
                false;

            nextRoundButton.style.display =
                "none";


            updateHUD();


            /* ---------------------------------------------
               SELECT MYSTERY CHARACTER
            --------------------------------------------- */

            const mysteryIndex =
                Math.floor(
                    Math.random() *
                    pages.length
                );

            currentMystery =
                pages[mysteryIndex];


            mysteryCharacter.textContent =
                currentMystery.name;


            /* ---------------------------------------------
               SELECT FOUR CANDIDATES
            --------------------------------------------- */

            const availablePages =
                pages.filter(
                    (_, index) =>
                        index !== mysteryIndex
                );


            const candidates =
                shuffle(
                    availablePages
                ).slice(0, 4);


            /* ---------------------------------------------
               READ MYSTERY PAGE
            --------------------------------------------- */

            const mysteryText =
                await readPage(
                    currentMystery
                );


            const mysteryVector =
                createVector(
                    tokenize(
                        mysteryText
                    )
                );


            /* ---------------------------------------------
               CALCULATE SIMILARITIES
            --------------------------------------------- */

            const candidateData = [];


            for (
                const candidate of candidates
            ) {

                const candidateText =
                    await readPage(
                        candidate
                    );


                const candidateVector =
                    createVector(
                        tokenize(
                            candidateText
                        )
                    );


                const similarity =
                    cosineSimilarity(
                        mysteryVector,
                        candidateVector
                    );


                candidateData.push({

                    page: candidate,

                    similarity:
                        similarity

                });

            }


            /* ---------------------------------------------
               FIND CORRECT ANSWER
            --------------------------------------------- */

            candidateData.sort(
                (a, b) =>
                    b.similarity -
                    a.similarity
            );


            currentCorrect =
                candidateData[0];


            /* ---------------------------------------------
               DISPLAY ANSWERS RANDOMLY
            --------------------------------------------- */

            const displayedCandidates =
                shuffle(
                    candidateData
                );


            displayedCandidates.forEach(
                candidateData => {

                    const button =
                        document.createElement(
                            "button"
                        );


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


                    choicesContainer.appendChild(
                        button
                    );

                }
            );


            startTimer();

        }
        catch (error) {

            console.error(
                "ROUND ERROR:",
                error
            );

            resultBox.style.display =
                "block";

            resultBox.className =
                "result-wrong";

            resultBox.innerHTML = `

                <div class="result-title">
                    GAME ERROR
                </div>

                <div class="result-explanation">

                    ${escapeHTML(
                        error.message
                    )}

                </div>

            `;

        }

    }


    /* =========================================================
       HANDLE ANSWER
    ========================================================= */

    function handleAnswer(
        selected,
        selectedButton
    ) {

        if (answered) {

            return;

        }


        answered = true;

        stopTimer();


        const allButtons =
            document.querySelectorAll(
                ".choice-button"
            );


        allButtons.forEach(
            button => {

                button.disabled = true;

            }
        );


        const isCorrect =
            selected.page.name ===
            currentCorrect.page.name;


        /* =====================================================
           CORRECT
        ===================================================== */

        if (isCorrect) {

            selectedButton.classList.add(
                "correct"
            );


            correctAnswers++;

            streak++;


            if (
                streak >
                bestStreak
            ) {

                bestStreak =
                    streak;

            }


            let points =
                100 +
                (timeLeft * 3) +
                ((streak - 1) * 25);


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
                        ${escapeHTML(
                            selected.page.name
                        )}
                    </strong>

                    has the highest textual similarity
                    to

                    <strong>
                        ${escapeHTML(
                            currentMystery.name
                        )}
                    </strong>.

                    <br><br>

                    The game compares Wikipedia pages
                    using a Bag-of-Words representation
                    and cosine similarity.

                    <br><br>

                    <strong>
                        +${points} points
                    </strong>

                </div>

            `;

        }

        /* =====================================================
           WRONG
        ===================================================== */

        else {

            selectedButton.classList.add(
                "wrong"
            );


            lives--;

            streak = 0;


            allButtons.forEach(
                button => {

                    if (
                        button.dataset.name ===
                        currentCorrect.page.name
                    ) {

                        button.classList.add(
                            "correct"
                        );

                    }

                }
            );


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
                        ${escapeHTML(
                            currentMystery.name
                        )}
                    </strong>.

                </div>

            `;

        }


        updateHUD();

        resultBox.style.display =
            "block";


        hintButton.disabled =
            true;

        skipButton.disabled =
            true;


        /* GAME OVER */

        if (lives <= 0) {

            setTimeout(
                finishGame,
                1800
            );

            return;

        }


        /* LAST ROUND */

        if (
            round >= TOTAL_ROUNDS
        ) {

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


    /* =========================================================
       TIME OUT
    ========================================================= */

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


        allButtons.forEach(
            button => {

                button.disabled = true;


                if (
                    button.dataset.name ===
                    currentCorrect.page.name
                ) {

                    button.classList.add(
                        "correct"
                    );

                }

            }
        );


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

            </div>

        `;


        resultBox.style.display =
            "block";


        hintButton.disabled =
            true;

        skipButton.disabled =
            true;


        updateHUD();


        if (lives <= 0) {

            setTimeout(
                finishGame,
                1800
            );

            return;

        }


        if (
            round >= TOTAL_ROUNDS
        ) {

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


    /* =========================================================
       HINT
    ========================================================= */

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

            hintButton.disabled =
                true;


            hintBox.style.display =
                "block";


            hintBox.innerHTML = `

                💡 <strong>HINT</strong>

                <br><br>

                Look for the character whose
                Wikipedia page discusses topics,
                relationships, or Marvel storylines
                similar to

                <strong>
                    ${escapeHTML(
                        currentMystery.name
                    )}
                </strong>.

                <br><br>

                ⚠️ Using a hint reduces your points.

            `;

        }
    );


    /* =========================================================
       SKIP
    ========================================================= */

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


            skipButton.disabled =
                true;

            hintButton.disabled =
                true;


            const allButtons =
                document.querySelectorAll(
                    ".choice-button"
                );


            allButtons.forEach(
                button => {

                    button.disabled = true;


                    if (
                        button.dataset.name ===
                        currentCorrect.page.name
                    ) {

                        button.classList.add(
                            "correct"
                        );

                    }

                }
            );


            streak = 0;


            resultBox.className =
                "result-wrong";


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

                </div>

            `;


            resultBox.style.display =
                "block";


            updateHUD();


            if (
                round >= TOTAL_ROUNDS
            ) {

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


    /* =========================================================
       NEXT ROUND
    ========================================================= */

    nextRoundButton.addEventListener(
        "click",
        () => {

            if (
                round >= TOTAL_ROUNDS
            ) {

                finishGame();

                return;

            }


            round++;

            createRound();

        }
    );


    /* =========================================================
       START GAME
    ========================================================= */

    startGameButton.addEventListener(
        "click",
        () => {

            console.log(
                "Text Detective started."
            );


            startScreen.style.display =
                "none";


            finalScreen.style.display =
                "none";


            gameScreen.style.display =
                "block";


            score = 0;

            lives =
                STARTING_LIVES;

            streak = 0;

            bestStreak = 0;

            correctAnswers = 0;

            round = 1;


            updateHUD();

            createRound();

        }
    );


    /* =========================================================
       FINISH GAME
    ========================================================= */

    function finishGame() {

        stopTimer();

        answered = true;


        const accuracy =
            round > 0
                ? Math.round(
                    (
                        correctAnswers /
                        round
                    ) * 100
                )
                : 0;


        let rank;


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
            Math.min(
                round,
                TOTAL_ROUNDS
            );

        finalStreak.textContent =
            bestStreak;

        finalAccuracy.textContent =
            `${accuracy}%`;


        gameScreen.style.display =
            "none";


        finalScreen.style.display =
            "flex";

    }


    /* =========================================================
       PLAY AGAIN
    ========================================================= */

    playAgainButton.addEventListener(
        "click",
        () => {

            finalScreen.style.display =
                "none";


            gameScreen.style.display =
                "block";


            score = 0;

            lives =
                STARTING_LIVES;

            streak = 0;

            bestStreak = 0;

            correctAnswers = 0;

            round = 1;


            updateHUD();

            createRound();

        }
    );


    /* =========================================================
       LOAD MARVEL DATASET
    ========================================================= */

    async function loadDataset() {

        try {

            loading.textContent =
                "Loading Marvel Wikipedia dataset...";


            const response =
                await fetch(
                    "../marvel_pages.zip"
                );


            if (!response.ok) {

                throw new Error(
                    `Could not load marvel_pages.zip (HTTP ${response.status})`
                );

            }


            const zipData =
                await response.arrayBuffer();


            if (
                typeof JSZip ===
                "undefined"
            ) {

                throw new Error(
                    "JSZip is not loaded."
                );

            }


            const zip =
                await JSZip.loadAsync(
                    zipData
                );


            pages = [];


            zip.forEach(
                (relativePath, file) => {

                    if (file.dir) {

                        return;

                    }


                    const lower =
                        relativePath.toLowerCase();


                    const validExtension =
                        lower.endsWith(".html") ||
                        lower.endsWith(".htm") ||
                        lower.endsWith(".txt");


                    if (!validExtension) {

                        return;

                    }


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

                        name:
                            name,

                        filename:
                            filename,

                        path:
                            relativePath,

                        file:
                            file

                    });

                }
            );


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


            setTimeout(
                () => {

                    loadingScreen.style.display =
                        "none";

                    startScreen.style.display =
                        "flex";

                },
                800
            );

        }
        catch (error) {

            console.error(
                "TEXT DETECTIVE DATASET ERROR:",
                error
            );


            loading.innerHTML = `

                <strong style="color:#ff4d52;">
                    Game error
                </strong>

                <br><br>

                ${escapeHTML(
                    error.message
                )}

                <br><br>

                Make sure
                <strong>
                    marvel_pages.zip
                </strong>
                is in the main project folder,
                one level above the
                <strong>week 5</strong>
                folder.

            `;

        }

    }


    /* =========================================================
       INITIAL STATE
    ========================================================= */

    gameScreen.style.display =
        "none";

    finalScreen.style.display =
        "none";

    startScreen.style.display =
        "none";

    loadingScreen.style.display =
        "flex";


    /* =========================================================
       START DATA LOADING
    ========================================================= */

    loadDataset();

});
