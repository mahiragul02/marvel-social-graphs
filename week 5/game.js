document.addEventListener("DOMContentLoaded", async function () {

    // =========================================================
    // HTML ELEMENTS
    // =========================================================

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

    const startScreen =
        document.getElementById("start-screen");

    const startGameButton =
        document.getElementById("start-game");

    const finalScreen =
        document.getElementById("final-screen");

    const playAgainButton =
        document.getElementById("play-again");

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


    // =========================================================
    // GAME VARIABLES
    // =========================================================

    let zip = null;

    let pages = [];

    let currentMystery = null;

    let currentCandidates = [];

    let currentMysteryVector = null;

    let currentCorrect = null;

    let timerInterval = null;

    let timeLeft = 30;

    let gameStarted = false;

    let round = 0;

    const TOTAL_ROUNDS = 10;

    let score = 0;

    let lives = 3;

    let streak = 0;

    let bestStreak = 0;

    let correctAnswers = 0;

    let answered = false;

    let hintUsed = false;

    let skipUsed = false;


    // =========================================================
    // STATUS
    // =========================================================

    function status(message) {

        console.log(message);

        if (loading) {

            loading.textContent =
                message;

        }

    }


    // =========================================================
    // CLEAN CHARACTER NAME
    // =========================================================

    function cleanCharacterName(filename) {

        let name =
            filename.split("/").pop();


        name =
            name.replace(
                /\.(html?|txt)$/i,
                ""
            );


        try {

            name =
                decodeURIComponent(name);

        }

        catch (error) {

            // Keep original name

        }


        name =
            name.replace(
                /[_-]+/g,
                " "
            );


        name =
            name.replace(
                /\s+/g,
                " "
            ).trim();


        return name;

    }


    // =========================================================
    // CLEAN TEXT
    // =========================================================

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
                " "
            )

            .replace(
                /&quot;/gi,
                " "
            )

            .replace(
                /&#39;/gi,
                " "
            )

            .toLowerCase()

            .replace(
                /[^a-z\s]/g,
                " "
            )

            .split(/\s+/)

            .filter(
                word => word.length >= 3
            );

    }


    // =========================================================
    // BAG OF WORDS
    // =========================================================

    function makeVector(text) {

        const words =
            cleanText(text);

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

        const allWords =
            new Set([
                ...Object.keys(a),
                ...Object.keys(b)
            ]);


        let dotProduct = 0;

        let magnitudeA = 0;

        let magnitudeB = 0;


        allWords.forEach(word => {

            const valueA =
                a[word] || 0;

            const valueB =
                b[word] || 0;


            dotProduct +=
                valueA * valueB;


            magnitudeA +=
                valueA * valueA;


            magnitudeB +=
                valueB * valueB;

        });


        if (
            magnitudeA === 0 ||
            magnitudeB === 0
        ) {

            return 0;

        }


        return dotProduct /
            (
                Math.sqrt(magnitudeA) *
                Math.sqrt(magnitudeB)
            );

    }


    // =========================================================
    // SHARED WORDS
    // =========================================================

    function getSharedWords(
        vectorA,
        vectorB
    ) {

        return Object.keys(vectorA)

            .filter(
                word => vectorB[word]
            )

            .sort(
                (a, b) => {

                    return (

                        vectorA[b] +
                        vectorB[b]

                    ) -

                    (

                        vectorA[a] +
                        vectorB[a]

                    );

                }
            )

            .slice(0, 10);

    }


    // =========================================================
    // LOAD DATASET
    // =========================================================

    async function loadDataset() {

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


        zip =
            await JSZip.loadAsync(
                buffer
            );


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


        if (
            filenames.length === 0
        ) {

            throw new Error(
                "No Marvel Wikipedia pages were found in the ZIP file."
            );

        }


        pages =
            filenames.map(filename => {

                return {

                    filename: filename,

                    name:
                        cleanCharacterName(
                            filename
                        )

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


        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    700
                )
        );

    }


    // =========================================================
    // READ PAGE
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
    // SHUFFLE
    // =========================================================

    function shuffle(array) {

        const copy =
            [...array];


        for (
            let i = copy.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() *
                    (i + 1)
                );


            [
                copy[i],
                copy[j]
            ] = [
                copy[j],
                copy[i]
            ];

        }


        return copy;

    }


    // =========================================================
    // UPDATE HUD
    // =========================================================

    function updateHUD() {

        scoreElement.textContent =
            score;


        livesElement.textContent =
            "❤️".repeat(lives) +
            "🖤".repeat(
                Math.max(0, 3 - lives)
            );


        streakElement.textContent =
            streak;


        timerElement.textContent =
            timeLeft;


        roundLabel.textContent =
            "ROUND " +
            Math.min(round, TOTAL_ROUNDS) +
            " / " +
            TOTAL_ROUNDS;


        const progress =
            ((round - 1) /
                TOTAL_ROUNDS) *
            100;


        progressFill.style.width =
            Math.max(
                0,
                Math.min(100, progress)
            ) + "%";

    }


    // =========================================================
    // TIMER
    // =========================================================

    function startTimer() {

        clearInterval(
            timerInterval
        );


        timeLeft = 30;

        updateHUD();


        timerInterval =
            setInterval(() => {

                if (
                    answered ||
                    !gameStarted
                ) {

                    return;

                }


                timeLeft--;

                updateHUD();


                if (
                    timeLeft <= 0
                ) {

                    clearInterval(
                        timerInterval
                    );


                    handleTimeOut();

                }

            }, 1000);

    }


    // =========================================================
    // STOP TIMER
    // =========================================================

    function stopTimer() {

        clearInterval(
            timerInterval
        );

    }


    // =========================================================
    // CREATE ROUND
    // =========================================================

    async function createRound() {

        try {

            answered = false;

            hintUsed = false;


            if (round > TOTAL_ROUNDS) {

                finishGame();

                return;

            }


            status(
                "Preparing a new mystery character..."
            );


            result.innerHTML = "";

            choices.innerHTML = "";

            hintBox.style.display =
                "none";

            hintBox.innerHTML = "";

            nextRound.style.display =
                "none";


            hintButton.disabled = false;

            skipButton.disabled = false;


            if (
                pages.length < 5
            ) {

                throw new Error(
                    "Not enough Marvel pages were found."
                );

            }


            const shuffledPages =
                shuffle(pages);


            currentMystery =
                shuffledPages[0];


            status(
                "Reading mystery character page..."
            );


            const mysteryText =
                await readPage(
                    currentMystery
                );


            if (!mysteryText) {

                throw new Error(
                    "Could not read the mystery character page."
                );

            }


            currentCandidates =
                shuffledPages.slice(1, 5);


            if (
                currentCandidates.length < 4
            ) {

                throw new Error(
                    "Could not create four answer choices."
                );

            }


            status(
                "Reading four candidate pages..."
            );


            const candidateData = [];


            for (
                const candidate
                of currentCandidates
            ) {

                const text =
                    await readPage(
                        candidate
                    );


                candidateData.push({

                    page: candidate,

                    name: candidate.name,

                    text: text,

                    vector: null,

                    similarity: 0

                });

            }


            status(
                "Calculating textual similarity..."
            );


            const mysteryVector =
                makeVector(
                    mysteryText
                );


            candidateData.forEach(
                candidate => {

                    candidate.vector =
                        makeVector(
                            candidate.text
                        );


                    candidate.similarity =
                        cosineSimilarity(
                            mysteryVector,
                            candidate.vector
                        );

                }
            );


            candidateData.sort(
                (a, b) =>
                    b.similarity -
                    a.similarity
            );


            currentCandidates =
                candidateData;


            currentMysteryVector =
                mysteryVector;


            currentCorrect =
                candidateData[0];


            // -------------------------------------------------
            // DISPLAY ANSWERS
            // -------------------------------------------------

            choices.innerHTML = "";


            candidateData.forEach(
                (candidate, index) => {

                    const button =
                        document.createElement(
                            "button"
                        );


                    button.type =
                        "button";


                    button.className =
                        "choice-button";


                    button.textContent =
                        candidate.name;


                    button.dataset.index =
                        index;


                    button.addEventListener(
                        "click",
                        function () {

                            handleAnswer(
                                candidate,
                                currentCorrect,
                                mysteryVector
                            );

                        }
                    );


                    choices.appendChild(
                        button
                    );

                }
            );


            loadingScreen.style.display =
                "none";


            roundLabel.textContent =
                "ROUND " +
                round +
                " / " +
                TOTAL_ROUNDS;


            updateHUD();


            startTimer();


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
    // HANDLE ANSWER
    // =========================================================

    function handleAnswer(
        selected,
        correct,
        mysteryVector
    ) {

        if (
            answered ||
            !gameStarted
        ) {

            return;

        }


        answered = true;

        stopTimer();


        const buttons =
            choices.querySelectorAll(
                "button"
            );


        buttons.forEach(
            button => {

                button.disabled =
                    true;


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

            }
        );


        const isCorrect =
            selected.name ===
            correct.name;


        const sharedWords =
            getSharedWords(
                mysteryVector,
                selected.vector
            );


        if (isCorrect) {

            correctAnswers++;

            streak++;

            bestStreak =
                Math.max(
                    bestStreak,
                    streak
                );


            let points =
                100;


            // Speed bonus

            points +=
                timeLeft * 3;


            // Streak bonus

            points +=
                Math.max(
                    0,
                    (streak - 1) * 25
                );


            // Hint penalty

            if (hintUsed) {

                points =
                    Math.max(
                        25,
                        points - 40
                    );

            }


            score += points;


            result.innerHTML = `

                <div class="result-success">

                    <h3>
                        🎉 Excellent Detective Work!
                    </h3>

                    <p>
                        <strong>
                            ${escapeHTML(selected.name)}
                        </strong>

                        had the highest textual
                        similarity among the four choices.
                    </p>

                    <p style="margin-top:8px;">
                        You earned
                        <strong>
                            +${points} points
                        </strong>
                        ${streak > 1
                            ? "🔥 Streak x" + streak
                            : ""}
                    </p>

                </div>

            `;

        }

        else {

            lives--;

            streak = 0;


            result.innerHTML = `

                <div class="result-wrong">

                    <h3>
                        ❌ Case Not Solved
                    </h3>

                    <p>
                        The strongest textual match was
                        <strong>
                            ${escapeHTML(correct.name)}
                        </strong>.
                    </p>

                    <p style="margin-top:8px;">
                        You lost one life.
                    </p>

                </div>

            `;

        }


        result.innerHTML += `

            <div class="similarity-result">

                <p>
                    <strong>
                        Your choice similarity:
                    </strong>

                    <span class="score-highlight">
                        ${selected.similarity.toFixed(3)}
                    </span>
                </p>


                <p>
                    <strong>
                        Best similarity:
                    </strong>

                    <span class="score-highlight">
                        ${correct.similarity.toFixed(3)}
                    </span>
                </p>


                <p>
                    <strong>
                        Shared words:
                    </strong>

                    ${
                        sharedWords.length > 0
                        ? escapeHTML(
                            sharedWords.join(", ")
                        )
                        : "No strong shared words found."
                    }
                </p>


                <details>

                    <summary>
                        🔬 Inspect the NLP method
                    </summary>

                    <p>
                        The game represents each Wikipedia
                        page as a
                        <strong>Bag-of-Words</strong>
                        vector.
                    </p>

                    <p>
                        Cosine similarity is then used
                        to compare the two vectors.
                    </p>

                    <p>
                        A higher score means that the pages
                        have more similar word distributions.
                    </p>

                    <p>
                        This method does not understand
                        word order or deeper semantic meaning.
                    </p>

                </details>

            </div>

        `;


        updateHUD();


        if (lives <= 0) {

            setTimeout(
                finishGame,
                1800
            );

            return;

        }


        nextRound.style.display =
            "inline-block";


        if (
            round >= TOTAL_ROUNDS
        ) {

            nextRound.textContent =
                "🏆 SEE RESULTS";

        }

    }


    // =========================================================
    // TIME OUT
    // =========================================================

    function handleTimeOut() {

        if (
            answered ||
            !gameStarted
        ) {

            return;

        }


        answered = true;


        const buttons =
            choices.querySelectorAll(
                "button"
            );


        buttons.forEach(
            button => {

                button.disabled =
                    true;


                if (
                    button.textContent ===
                    currentCorrect.name
                ) {

                    button.classList.add(
                        "correct"
                    );

                }

            }
        );


        lives--;

        streak = 0;


        result.innerHTML = `

            <div class="result-wrong">

                <h3>
                    ⏰ Time's Up!
                </h3>

                <p>
                    The mystery character was best
                    matched by
                    <strong>
                        ${escapeHTML(
                            currentCorrect.name
                        )}
                    </strong>.
                </p>

                <p style="margin-top:8px;">
                    You lost one life.
                </p>

            </div>

        `;


        updateHUD();


        if (lives <= 0) {

            setTimeout(
                finishGame,
                1800
            );

        }

        else {

            nextRound.style.display =
                "inline-block";

        }

    }


    // =========================================================
    // HINT
    // =========================================================

    hintButton.addEventListener(
        "click",
        function () {

            if (
                answered ||
                hintUsed
            ) {

                return;

            }


            hintUsed = true;


            const sharedWords =
                getSharedWords(
                    currentMysteryVector,
                    currentCorrect.vector
                );


            hintBox.style.display =
                "block";


            if (
                sharedWords.length > 0
            ) {

                hintBox.innerHTML = `

                    💡 <strong>Detective Hint:</strong>

                    The strongest candidate shares words such as:

                    <strong>
                        ${escapeHTML(
                            sharedWords
                                .slice(0, 5)
                                .join(", ")
                        )}
                    </strong>

                    <br><br>

                    Using this hint reduces your
                    potential score for this round.

                `;

            }

            else {

                hintBox.innerHTML = `

                    💡 <strong>Detective Hint:</strong>

                    Look carefully at the character
                    descriptions. The correct answer has
                    the highest cosine similarity.

                `;

            }


            hintButton.disabled =
                true;

        }
    );


    // =========================================================
    // SKIP
    // =========================================================

    skipButton.addEventListener(
        "click",
        function () {

            if (
                answered ||
                skipUsed
            ) {

                return;

            }


            skipUsed = true;

            hintButton.disabled =
                true;

            skipButton.disabled =
                true;


            stopTimer();


            result.innerHTML = `

                <div class="result-wrong">

                    <h3>
                        ⏭️ Case Skipped
                    </h3>

                    <p>
                        The strongest textual match was
                        <strong>
                            ${escapeHTML(
                                currentCorrect.name
                            )}
                        </strong>.
                    </p>

                </div>

            `;


            answered = true;

            streak = 0;


            const buttons =
                choices.querySelectorAll(
                    "button"
                );


            buttons.forEach(
                button => {

                    button.disabled =
                        true;


                    if (
                        button.textContent ===
                        currentCorrect.name
                    ) {

                        button.classList.add(
                            "correct"
                        );

                    }

                }
            );


            updateHUD();


            nextRound.style.display =
                "inline-block";

        }
    );


    // =========================================================
    // NEXT ROUND
    // =========================================================

    nextRound.addEventListener(
        "click",
        async function () {

            if (
                !answered
            ) {

                return;

            }


            if (
                round >= TOTAL_ROUNDS
            ) {

                finishGame();

                return;

            }


            round++;


            skipUsed = false;


            loadingScreen.style.display =
                "flex";


            status(
                "Preparing the next mystery..."
            );


            await createRound();

        }
    );


    // =========================================================
    // START GAME
    // =========================================================

    startGameButton.addEventListener(
        "click",
        async function () {

            startScreen.style.display =
                "none";


            gameStarted = true;

            round = 1;

            score = 0;

            lives = 3;

            streak = 0;

            bestStreak = 0;

            correctAnswers = 0;


            updateHUD();


            await createRound();

        }
    );


    // =========================================================
    // PLAY AGAIN
    // =========================================================

    playAgainButton.addEventListener(
        "click",
        async function () {

            finalScreen.style.display =
                "none";


            gameStarted = true;

            round = 1;

            score = 0;

            lives = 3;

            streak = 0;

            bestStreak = 0;

            correctAnswers = 0;


            updateHUD();


            await createRound();

        }
    );


    // =========================================================
    // FINAL SCREEN
    // =========================================================

    function finishGame() {

        stopTimer();


        gameStarted = false;


        const accuracy =
            round > 0
                ? Math.round(
                    (correctAnswers /
                    Math.min(
                        round,
                        TOTAL_ROUNDS
                    )) * 100
                )
                : 0;


        let rank = "";


        if (score >= 1200) {

            rank =
                "🦸 MARVEL MASTER";

        }

        else if (score >= 850) {

            rank =
                "🏆 SUPER DETECTIVE";

        }

        else if (score >= 550) {

            rank =
                "🕵️ ELITE AGENT";

        }

        else if (score >= 300) {

            rank =
                "🔎 FIELD DETECTIVE";

        }

        else {

            rank =
                "🛡️ S.H.I.E.L.D. TRAINEE";

        }


        document.getElementById(
            "final-score"
        ).textContent =
            score;


        document.getElementById(
            "final-rank"
        ).textContent =
            rank;


        document.getElementById(
            "final-correct"
        ).textContent =
            correctAnswers;


        document.getElementById(
            "final-rounds"
        ).textContent =
            Math.min(
                round,
                TOTAL_ROUNDS
            );


        document.getElementById(
            "final-streak"
        ).textContent =
            bestStreak;


        document.getElementById(
            "final-accuracy"
        ).textContent =
            accuracy + "%";


        finalScreen.style.display =
            "flex";

    }


    // =========================================================
    // ERROR
    // =========================================================

    function showError(error) {

        console.error(
            "GAME ERROR:",
            error
        );


        loadingScreen.style.display =
            "flex";


        loading.innerHTML = `

            <div class="error-message">

                <strong>
                    Game error
                </strong>

                <br><br>

                ${escapeHTML(
                    error.message
                )}

            </div>

        `;

    }


    // =========================================================
    // HTML ESCAPE
    // =========================================================

    function escapeHTML(value) {

        return String(value || "")

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


    // =========================================================
    // INITIAL DATA LOAD
    // =========================================================

    try {

        status(
            "Starting Marvel Text Detective..."
        );


        await loadDataset();


        /*
         * Dataset is ready.
         *
         * Hide loading screen and show
         * mission briefing.
         */

        loadingScreen.style.display =
            "none";


        startScreen.style.display =
            "flex";


        updateHUD();

    }

    catch (error) {

        showError(error);

    }

});
