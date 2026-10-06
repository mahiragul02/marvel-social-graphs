// ============================================================
// MARVEL TEXT ANALYSIS — WEEK 5 FIGURE
// Histogram of pairwise cosine textual similarity
// ============================================================

document.addEventListener("DOMContentLoaded", async function () {

    const status = document.getElementById("figure-status");
    const canvas = document.getElementById("similarity-figure");
    const list = document.getElementById("strongest-matches");

    try {

        status.textContent = "Loading Marvel data...";

        // ====================================================
        // LOAD FILE
        // ====================================================

        async function getText(path) {

            const response = await fetch(path);

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


        const nodesText =
            await getText("../week1_nodes.tsv");

        console.log("Nodes file loaded");


        // ====================================================
        // PARSE TSV
        // ====================================================

        function parseTSV(text) {

            return text
                .trim()
                .split(/\r?\n/)
                .map(line => line.split("\t"));

        }


        const nodeRows =
            parseTSV(nodesText);


        // ====================================================
        // HEADER DETECTION
        // ====================================================

        function isHeader(row) {

            if (!row) return false;

            const text =
                row.join(" ").toLowerCase();

            return (
                text.includes("source") ||
                text.includes("target") ||
                text.includes("name") ||
                text.includes("label") ||
                text.includes("id")
            );

        }


        const nodeStart =
            isHeader(nodeRows[0]) ? 1 : 0;


        // ====================================================
        // EXTRACT CHARACTER NAMES
        // ====================================================

        const characters = [];


        for (
            let i = nodeStart;
            i < nodeRows.length;
            i++
        ) {

            const row = nodeRows[i];

            if (!row.length) continue;

            let name = null;


            for (const value of row) {

                const v = value.trim();

                if (
                    v &&
                    isNaN(v) &&
                    v.length > 1
                ) {

                    name = v;
                    break;

                }

            }


            if (name) {

                characters.push(name);

            }

        }


        if (characters.length === 0) {

            throw new Error(
                "No Marvel characters were found."
            );

        }


        console.log(
            "Characters found:",
            characters.length
        );


        // ====================================================
        // NORMALIZE NAMES
        // ====================================================

        function normalize(name) {

            return name
                .toLowerCase()
                .replace(/[_-]/g, " ")
                .replace(/\.(html?|txt)$/i, "")
                .replace(/\s+/g, " ")
                .trim();

        }


        // ====================================================
        // LOAD ZIP
        // ====================================================

        status.textContent =
            "Loading Marvel Wikipedia pages...";


        if (typeof JSZip === "undefined") {

            throw new Error(
                "JSZip was not loaded."
            );

        }


        const zipResponse =
            await fetch("../marvel_pages.zip");


        if (!zipResponse.ok) {

            throw new Error(
                "Could not load marvel_pages.zip"
            );

        }


        const zipBuffer =
            await zipResponse.arrayBuffer();


        const zip =
            await JSZip.loadAsync(zipBuffer);


        const files =
            Object.keys(zip.files)
                .filter(
                    filename =>
                        !zip.files[filename].dir
                );


        console.log(
            "ZIP files:",
            files.length
        );


        // ====================================================
        // INDEX ZIP PAGES
        // ====================================================

        const pages = {};


        for (const filename of files) {

            const file =
                zip.files[filename];


            const text =
                await file.async("text");


            const shortName =
                filename
                    .split("/")
                    .pop()
                    .replace(/\.(html?|txt)$/i, "")
                    .replace(/_/g, " ")
                    .trim();


            pages[normalize(shortName)] =
                text;

        }


        console.log(
            "Pages indexed:",
            Object.keys(pages).length
        );


        // ====================================================
        // MATCH CHARACTER → PAGE
        // ====================================================

        const characterText = {};


        for (const character of characters) {

            const key =
                normalize(character);


            if (pages[key]) {

                characterText[character] =
                    pages[key];

                continue;

            }


            const possible =
                Object.keys(pages).find(
                    pageName =>
                        pageName.includes(key) ||
                        key.includes(pageName)
                );


            if (possible) {

                characterText[character] =
                    pages[possible];

            }

        }


        const matchedCount =
            Object.keys(characterText).length;


        console.log(
            "Characters with text:",
            matchedCount
        );


        if (matchedCount < 10) {

            throw new Error(
                "Too few Marvel Wikipedia pages could be matched."
            );

        }


        // ====================================================
        // STOPWORDS
        // ====================================================

        const stopwords = new Set([

            "the", "and", "for", "that", "with",
            "this", "from", "were", "was", "are",
            "his", "her", "their", "have", "has",
            "had", "not", "but", "which", "who",
            "into", "also", "been", "being", "they",
            "them", "than", "then", "when", "where",
            "about", "after", "before", "during",
            "while", "there", "these", "those",
            "more", "most", "other", "some",
            "such", "only", "very", "known"

        ]);


        // ====================================================
        // BAG OF WORDS
        // ====================================================

        function vectorize(text) {

            const words =
                text
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
                            word.length >= 3 &&
                            !stopwords.has(word)
                    );


            const vector = {};


            for (const word of words) {

                vector[word] =
                    (vector[word] || 0) + 1;

            }


            return vector;

        }


        const vectors = {};


        for (const character in characterText) {

            vectors[character] =
                vectorize(
                    characterText[character]
                );

        }


        // ====================================================
        // COSINE SIMILARITY
        // ====================================================

        function cosine(a, b) {

            let dot = 0;
            let normA = 0;
            let normB = 0;


            for (const word in a) {

                if (b[word]) {

                    dot +=
                        a[word] * b[word];

                }

                normA +=
                    a[word] * a[word];

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


        // ====================================================
        // CALCULATE PAIRWISE SIMILARITY
        // ====================================================

        status.textContent =
            "Calculating textual similarity...";


        const names =
            Object.keys(vectors);


        const similarities = [];


        for (
            let i = 0;
            i < names.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < names.length;
                j++
            ) {

                const a = names[i];
                const b = names[j];


                similarities.push({

                    a: a,

                    b: b,

                    similarity:
                        cosine(
                            vectors[a],
                            vectors[b]
                        )

                });

            }

        }


        console.log(
            "Similarity pairs:",
            similarities.length
        );


        // ====================================================
        // SORT
        // ====================================================

        similarities.sort(
            (a, b) =>
                b.similarity -
                a.similarity
        );


        // ====================================================
        // TOP 5
        // ====================================================

        const strongest =
            similarities.slice(0, 5);


        list.innerHTML = "";


        strongest.forEach(
            (pair, index) => {

                const li =
                    document.createElement("li");


                li.innerHTML =
                    "<strong>" +
                    (index + 1) +
                    ".</strong> " +
                    pair.a +
                    " ↔ " +
                    pair.b +
                    " — " +
                    "<strong>" +
                    (pair.similarity * 100)
                        .toFixed(2) +
                    "%</strong> similarity";


                list.appendChild(li);

            }
        );


        // ====================================================
        // DRAW CANVAS
        // ====================================================

        status.textContent =
            "Drawing figure...";


        const ctx =
            canvas.getContext("2d");


        canvas.width = 900;
        canvas.height = 540;


        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );


        // Background

        ctx.fillStyle =
            "#ffffff";

        ctx.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
        );


        // ====================================================
        // TITLE
        // ====================================================

        ctx.fillStyle =
            "#172033";

        ctx.font =
            "bold 24px Arial";

        ctx.textAlign =
            "center";

        ctx.fillText(
            "Marvel Character Textual Similarity",
            450,
            38
        );


        // ====================================================
        // HISTOGRAM
        // ====================================================

        const bins = 10;

        const counts =
            new Array(bins).fill(0);


        similarities.forEach(
            pair => {

                let index =
                    Math.floor(
                        pair.similarity * bins
                    );


                if (index >= bins) {

                    index = bins - 1;

                }


                if (index < 0) {

                    index = 0;

                }


                counts[index]++;

            }
        );


        const maxCount =
            Math.max(...counts);


        const chartLeft = 95;
        const chartTop = 90;
        const chartBottom = 440;
        const chartWidth = 730;
        const chartHeight =
            chartBottom - chartTop;


        // ====================================================
        // GRID LINES
        // ====================================================

        ctx.strokeStyle =
            "#e5e7eb";

        ctx.lineWidth = 1;


        for (
            let i = 0;
            i <= 5;
            i++
        ) {

            const y =
                chartBottom -
                (i / 5) *
                chartHeight;


            ctx.beginPath();

            ctx.moveTo(
                chartLeft,
                y
            );

            ctx.lineTo(
                chartLeft + chartWidth,
                y
            );

            ctx.stroke();

        }


        // ====================================================
        // AXES
        // ====================================================

        ctx.strokeStyle =
            "#374151";

        ctx.lineWidth = 1.5;


        ctx.beginPath();

        ctx.moveTo(
            chartLeft,
            chartTop
        );

        ctx.lineTo(
            chartLeft,
            chartBottom
        );

        ctx.lineTo(
            chartLeft + chartWidth,
            chartBottom
        );

        ctx.stroke();


        // ====================================================
        // BARS
        // ====================================================

        const barWidth =
            chartWidth / bins;


        counts.forEach(
            (count, i) => {

                const height =
                    maxCount === 0
                        ? 0
                        :
                        (
                            count /
                            maxCount
                        ) *
                        chartHeight;


                const x =
                    chartLeft +
                    i *
                    barWidth;


                const y =
                    chartBottom -
                    height;


                ctx.fillStyle =
                    "#e63946";


                ctx.fillRect(
                    x + 5,
                    y,
                    barWidth - 10,
                    height
                );

            }
        );


        // ====================================================
        // X TICKS
        // ====================================================

        ctx.fillStyle =
            "#374151";

        ctx.font =
            "12px Arial";

        ctx.textAlign =
            "center";


        for (
            let i = 0;
            i <= 10;
            i++
        ) {

            const x =
                chartLeft +
                (i / 10) *
                chartWidth;


            ctx.fillText(
                (i / 10).toFixed(1),
                x,
                chartBottom + 22
            );

        }


        // ====================================================
        // X LABEL
        // ====================================================

        ctx.font =
            "14px Arial";


        ctx.fillText(
            "Cosine textual similarity",
            450,
            500
        );


        // ====================================================
        // Y LABEL
        // ====================================================

        ctx.save();


        ctx.translate(
            28,
            275
        );


        ctx.rotate(
            -Math.PI / 2
        );


        ctx.fillText(
            "Number of character pairs",
            0,
            0
        );


        ctx.restore();


        // ====================================================
        // STATUS
        // ====================================================

        status.textContent =
            "Figure generated successfully from " +
            matchedCount +
            " Marvel Wikipedia pages and " +
            similarities.length +
            " character pairs.";


        console.log(
            "Week 5 figure generated successfully."
        );

    }


    catch (error) {

        console.error(
            "WEEK 5 FIGURE ERROR:",
            error
        );


        status.textContent =
            "Figure error: " +
            error.message;

    }

});
