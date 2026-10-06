// ============================================================
// MARVEL TEXT DETECTIVE — WEEK 5 FIGURE
// Robust version
// ============================================================

document.addEventListener("DOMContentLoaded", async function () {

    const status = document.getElementById("figure-status");
    const canvas = document.getElementById("similarity-figure");
    const list = document.getElementById("strongest-matches");

    try {

        status.textContent = "Loading Marvel data...";

        // ----------------------------------------------------
        // LOAD TSV
        // ----------------------------------------------------

        async function getText(path) {

            const response = await fetch(path);

            if (!response.ok) {
                throw new Error(
                    "Could not load " + path +
                    " (HTTP " + response.status + ")"
                );
            }

            return await response.text();
        }


        const nodesText =
            await getText("../week1_nodes.tsv");

        const edgesText =
            await getText("../week1_edges.tsv");


        console.log("Nodes file loaded");
        console.log("Edges file loaded");


        // ----------------------------------------------------
        // PARSE TSV
        // ----------------------------------------------------

        function parseTSV(text) {

            const lines =
                text.trim().split(/\r?\n/);

            if (lines.length === 0) {
                return [];
            }

            return lines.map(line =>
                line.split("\t")
            );

        }


        const nodeRows =
            parseTSV(nodesText);

        const edgeRows =
            parseTSV(edgesText);


        console.log("First node row:", nodeRows[0]);
        console.log("First edge row:", edgeRows[0]);


        // ----------------------------------------------------
        // DETERMINE WHETHER THERE IS A HEADER
        // ----------------------------------------------------

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

        const edgeStart =
            isHeader(edgeRows[0]) ? 1 : 0;


        // ----------------------------------------------------
        // NODE NAMES
        // ----------------------------------------------------

        const characters = [];


        for (
            let i = nodeStart;
            i < nodeRows.length;
            i++
        ) {

            const row =
                nodeRows[i];

            if (!row.length) continue;


            // The node name is normally the last
            // or first useful text column.
            let name = null;


            for (const value of row) {

                const v =
                    value.trim();

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


        console.log(
            "Characters found:",
            characters.length
        );


        if (characters.length === 0) {

            throw new Error(
                "No Marvel characters were found in week1_nodes.tsv."
            );

        }


        // ----------------------------------------------------
        // NORMALIZE NAMES
        // ----------------------------------------------------

        function normalize(name) {

            return name
                .toLowerCase()
                .replace(/[_-]/g, " ")
                .replace(/\.(html?|txt)$/i, "")
                .replace(/\s+/g, " ")
                .trim();

        }


        // ----------------------------------------------------
        // LOAD ZIP
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // CREATE PAGE LOOKUP
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // FIND TEXT FOR CHARACTER
        // ----------------------------------------------------

        const characterText = {};


        for (const character of characters) {

            const key =
                normalize(character);


            if (pages[key]) {

                characterText[character] =
                    pages[key];

                continue;

            }


            // Try partial matching
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


        console.log(
            "Characters with Wikipedia text:",
            Object.keys(characterText).length
        );


        if (
            Object.keys(characterText).length < 10
        ) {

            throw new Error(
                "Too few Marvel Wikipedia pages could be matched."
            );

        }


        // ----------------------------------------------------
        // BAG OF WORDS
        // ----------------------------------------------------

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


        function vectorize(text) {

            const words =
                text
                    .toLowerCase()
                    .replace(/<script[\s\S]*?<\/script>/gi, " ")
                    .replace(/<style[\s\S]*?<\/style>/gi, " ")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/[^a-z0-9\s]/g, " ")
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


        // ----------------------------------------------------
        // COSINE SIMILARITY
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // CALCULATE ALL TEXTUAL SIMILARITIES
        // ----------------------------------------------------

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

                const a =
                    names[i];

                const b =
                    names[j];


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


        // ----------------------------------------------------
        // SORT STRONGEST MATCHES
        // ----------------------------------------------------

        similarities.sort(
            (a, b) =>
                b.similarity -
                a.similarity
        );


        const strongest =
            similarities.slice(0, 5);


        // ----------------------------------------------------
        // DISPLAY STRONGEST MATCHES
        // ----------------------------------------------------

        list.innerHTML = "";


        strongest.forEach(pair => {

            const li =
                document.createElement("li");


            li.textContent =
                pair.a +
                " ↔ " +
                pair.b +
                " — similarity " +
                pair.similarity.toFixed(3);


            list.appendChild(li);

        });


        // ----------------------------------------------------
        // DRAW FIGURE
        // ----------------------------------------------------

        status.textContent =
            "Drawing figure...";


        const ctx =
            canvas.getContext("2d");


        canvas.width = 850;
        canvas.height = 500;


        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );


        // Background
        ctx.fillStyle = "white";

        ctx.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
        );


        // ----------------------------------------------------
        // TITLE
        // ----------------------------------------------------

        ctx.fillStyle =
            "#172033";

        ctx.font =
            "bold 22px Arial";

        ctx.textAlign =
            "center";


        ctx.fillText(
            "Marvel Character Textual Similarity",
            425,
            35
        );


        // ----------------------------------------------------
        // HISTOGRAM
        // ----------------------------------------------------

        const bins = 10;

        const counts =
            new Array(bins).fill(0);


        similarities.forEach(pair => {

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

        });


        const maxCount =
            Math.max(...counts);


        const chartLeft = 80;
        const chartBottom = 420;
        const chartWidth = 700;
        const chartHeight = 330;


        // Axes
        ctx.strokeStyle =
            "#374151";

        ctx.lineWidth = 1.5;


        ctx.beginPath();

        ctx.moveTo(
            chartLeft,
            chartBottom - chartHeight
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


        // Bars
        const barWidth =
            chartWidth / bins;


        counts.forEach(
            (count, i) => {

                const height =
                    maxCount === 0
                        ? 0
                        : (
                            count /
                            maxCount
                        ) *
                        chartHeight;


                const x =
                    chartLeft +
                    i * barWidth;


                const y =
                    chartBottom -
                    height;


                ctx.fillStyle =
                    "#2563eb";


                ctx.fillRect(
                    x + 3,
                    y,
                    barWidth - 6,
                    height
                );

            }
        );


        // ----------------------------------------------------
        // X LABEL
        // ----------------------------------------------------

        ctx.fillStyle =
            "#374151";

        ctx.font =
            "14px Arial";

        ctx.textAlign =
            "center";


        ctx.fillText(
            "Cosine textual similarity",
            425,
            475
        );


        // ----------------------------------------------------
        // X TICKS
        // ----------------------------------------------------

        ctx.font =
            "12px Arial";


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
                chartBottom + 20
            );

        }


        // ----------------------------------------------------
        // Y LABEL
        // ----------------------------------------------------

        ctx.save();


        ctx.translate(
            25,
            250
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


        // ----------------------------------------------------
        // FINAL STATUS
        // ----------------------------------------------------

        status.textContent =
            "Figure generated successfully from " +
            Object.keys(characterText).length +
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
