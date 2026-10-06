// Week 5 — Textual Similarity vs Network Connection

const FIGURE_WIDTH = 850;
const FIGURE_HEIGHT = 500;

async function loadTSV(path) {
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`Could not load ${path}`);
    }

    const text = await response.text();

    return text
        .trim()
        .split(/\r?\n/)
        .map(line => line.split("\t"));
}

function cosineSimilarity(vectorA, vectorB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    const words = new Set([
        ...Object.keys(vectorA),
        ...Object.keys(vectorB)
    ]);

    words.forEach(word => {
        const a = vectorA[word] || 0;
        const b = vectorB[word] || 0;

        dot += a * b;
        normA += a * a;
        normB += b * b;
    });

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function textToVector(text) {

    const stopwords = new Set([
        "the", "and", "of", "to", "in", "a", "is", "for",
        "on", "with", "as", "by", "an", "at", "from", "that",
        "this", "was", "were", "it", "his", "her", "he", "she",
        "they", "their", "be", "has", "had", "have", "or",
        "which", "who", "also", "but", "not", "into", "its"
    ]);

    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(word =>
            word.length > 2 &&
            !stopwords.has(word)
        );

    const vector = {};

    words.forEach(word => {
        vector[word] = (vector[word] || 0) + 1;
    });

    return vector;
}

function parseTSV(rows) {

    const header = rows[0];

    return rows.slice(1).map(row => {

        const object = {};

        header.forEach((key, i) => {
            object[key.trim()] = row[i] ? row[i].trim() : "";
        });

        return object;
    });
}

function findColumn(object, possibleNames) {

    const keys = Object.keys(object);

    return keys.find(key =>
        possibleNames.some(name =>
            key.toLowerCase() === name.toLowerCase()
        )
    );
}

async function buildFigure() {

    const status = document.getElementById("figure-status");

    try {

        status.textContent = "Loading Marvel network…";

        const nodeRows = await loadTSV("../week1_nodes.tsv");
        const edgeRows = await loadTSV("../week1_edges.tsv");

        const nodes = parseTSV(nodeRows);
        const edges = parseTSV(edgeRows);

        console.log("Nodes:", nodes);
        console.log("Edges:", edges);

        // Try to identify the important columns automatically.
        const sampleNode = nodes[0];
        const sampleEdge = edges[0];

        const nodeNameColumn =
            findColumn(sampleNode, [
                "name",
                "Name",
                "label",
                "Label",
                "title",
                "Title"
            ]);

        const sourceColumn =
            findColumn(sampleEdge, [
                "source",
                "Source",
                "from",
                "From"
            ]);

        const targetColumn =
            findColumn(sampleEdge, [
                "target",
                "Target",
                "to",
                "To"
            ]);

        if (!nodeNameColumn || !sourceColumn || !targetColumn) {
            throw new Error(
                "Could not identify the node/edge columns. Check the TSV files."
            );
        }

        // ---------------------------------------------------------
        // Network connections
        // ---------------------------------------------------------

        const connections = new Set();

        edges.forEach(edge => {

            const source = edge[sourceColumn];
            const target = edge[targetColumn];

            if (!source || !target) return;

            connections.add(`${source}|||${target}`);
            connections.add(`${target}|||${source}`);
        });

        // ---------------------------------------------------------
        // Wikipedia text
        // ---------------------------------------------------------
        //
        // The game already loads the pages from marvel_pages.zip.
        // This figure therefore uses the same page collection.
        //
        // If figure.js cannot access the ZIP directly, the figure
        // will display an explanatory message instead of breaking
        // the rest of the website.
        // ---------------------------------------------------------

        if (typeof JSZip === "undefined") {
            throw new Error("JSZip has not loaded.");
        }

        status.textContent = "Loading Marvel Wikipedia pages…";

        const zipResponse = await fetch("../marvel_pages.zip");

        if (!zipResponse.ok) {
            throw new Error("Could not load marvel_pages.zip");
        }

        const zipData = await zipResponse.arrayBuffer();
        const zip = await JSZip.loadAsync(zipData);

        const pages = {};

        for (const filename of Object.keys(zip.files)) {

            const file = zip.files[filename];

            if (file.dir) continue;

            const content = await file.async("text");

            const baseName = filename
                .split("/")
                .pop()
                .replace(/\.(html?|txt)$/i, "")
                .replace(/_/g, " ")
                .trim();

            if (baseName.length > 0) {
                pages[baseName] = content;
            }
        }

        console.log("Pages loaded:", Object.keys(pages).length);

        // ---------------------------------------------------------
        // Match node names to page names
        // ---------------------------------------------------------

        const textVectors = {};

        nodes.forEach(node => {

            const name = node[nodeNameColumn];

            if (!name) return;

            let pageText = pages[name];

            // Try case-insensitive matching if necessary.
            if (!pageText) {

                const matchingKey =
                    Object.keys(pages).find(key =>
                        key.toLowerCase() === name.toLowerCase()
                    );

                if (matchingKey) {
                    pageText = pages[matchingKey];
                }
            }

            if (pageText) {
                textVectors[name] = textToVector(pageText);
            }
        });

        const names = Object.keys(textVectors);

        console.log("Characters with text:", names.length);

        // ---------------------------------------------------------
        // Calculate pairwise similarities
        // ---------------------------------------------------------

        const connected = [];
        const notConnected = [];

        for (let i = 0; i < names.length; i++) {

            for (let j = i + 1; j < names.length; j++) {

                const a = names[i];
                const b = names[j];

                const similarity =
                    cosineSimilarity(
                        textVectors[a],
                        textVectors[b]
                    );

                const isConnected =
                    connections.has(`${a}|||${b}`);

                const point = {
                    a,
                    b,
                    similarity
                };

                if (isConnected) {
                    connected.push(point);
                } else {
                    notConnected.push(point);
                }
            }
        }

        console.log("Connected pairs:", connected.length);
        console.log("Non-connected pairs:", notConnected.length);

        // ---------------------------------------------------------
        // Create the figure
        // ---------------------------------------------------------

        const canvas = document.getElementById("similarity-figure");

        const ctx = canvas.getContext("2d");

        canvas.width = FIGURE_WIDTH;
        canvas.height = FIGURE_HEIGHT;

        ctx.clearRect(0, 0, FIGURE_WIDTH, FIGURE_HEIGHT);

        const margin = {
            left: 80,
            right: 30,
            top: 50,
            bottom: 70
        };

        const plotWidth =
            FIGURE_WIDTH - margin.left - margin.right;

        const plotHeight =
            FIGURE_HEIGHT - margin.top - margin.bottom;

        const allPoints = [
            ...connected,
            ...notConnected
        ];

        const maxSimilarity =
            Math.max(
                ...allPoints.map(p => p.similarity),
                0.1
            );

        // ---------------------------------------------------------
        // Title
        // ---------------------------------------------------------

        ctx.font = "bold 22px Arial";
        ctx.fillStyle = "#172033";
        ctx.textAlign = "center";

        ctx.fillText(
            "Textual Similarity vs. Network Connection",
            FIGURE_WIDTH / 2,
            28
        );

        // ---------------------------------------------------------
        // Axes
        // ---------------------------------------------------------

        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1;

        ctx.beginPath();

        ctx.moveTo(
            margin.left,
            margin.top
        );

        ctx.lineTo(
            margin.left,
            FIGURE_HEIGHT - margin.bottom
        );

        ctx.lineTo(
            FIGURE_WIDTH - margin.right,
            FIGURE_HEIGHT - margin.bottom
        );

        ctx.stroke();

        // ---------------------------------------------------------
        // X-axis
        // ---------------------------------------------------------

        ctx.font = "14px Arial";
        ctx.fillStyle = "#444";
        ctx.textAlign = "center";

        ctx.fillText(
            "Cosine textual similarity",
            FIGURE_WIDTH / 2,
            FIGURE_HEIGHT - 20
        );

        // ---------------------------------------------------------
        // Y-axis
        // ---------------------------------------------------------

        ctx.save();

        ctx.translate(20, FIGURE_HEIGHT / 2);
        ctx.rotate(-Math.PI / 2);

        ctx.fillText(
            "Network relationship",
            0,
            0
        );

        ctx.restore();

        // ---------------------------------------------------------
        // Horizontal category labels
        // ---------------------------------------------------------

        ctx.font = "13px Arial";

        ctx.fillText(
            "0",
            margin.left,
            FIGURE_HEIGHT - margin.bottom + 25
        );

        ctx.fillText(
            maxSimilarity.toFixed(2),
            FIGURE_WIDTH - margin.right,
            FIGURE_HEIGHT - margin.bottom + 25
        );

        // ---------------------------------------------------------
        // Draw points
        // ---------------------------------------------------------

        function drawPoint(point, y, radius) {

            const x =
                margin.left +
                (point.similarity / maxSimilarity) *
                plotWidth;

            ctx.beginPath();

            ctx.arc(
                x,
                y,
                radius,
                0,
                Math.PI * 2
            );

            ctx.fill();

        }

        // Connected pairs
        ctx.fillStyle = "#2563eb";

        connected.forEach(point => {
            drawPoint(
                point,
                margin.top + plotHeight * 0.30,
                3
            );
        });

        // Non-connected pairs
        ctx.fillStyle = "#9ca3af";

        notConnected.forEach(point => {
            drawPoint(
                point,
                margin.top + plotHeight * 0.72,
                3
            );
        });

        // ---------------------------------------------------------
        // Category labels
        // ---------------------------------------------------------

        ctx.font = "bold 14px Arial";
        ctx.fillStyle = "#172033";
        ctx.textAlign = "right";

        ctx.fillText(
            "Connected",
            margin.left - 10,
            margin.top + plotHeight * 0.30 + 5
        );

        ctx.fillText(
            "Not connected",
            margin.left - 10,
            margin.top + plotHeight * 0.72 + 5
        );

        // ---------------------------------------------------------
        // Legend
        // ---------------------------------------------------------

        ctx.textAlign = "left";
        ctx.font = "13px Arial";

        ctx.fillStyle = "#2563eb";

        ctx.fillRect(
            FIGURE_WIDTH - 180,
            12,
            12,
            12
        );

        ctx.fillStyle = "#444";

        ctx.fillText(
            "Connected pair",
            FIGURE_WIDTH - 160,
            23
        );

        ctx.fillStyle = "#9ca3af";

        ctx.fillRect(
            FIGURE_WIDTH - 180,
            31,
            12,
            12
        );

        ctx.fillStyle = "#444";

        ctx.fillText(
            "Non-connected pair",
            FIGURE_WIDTH - 160,
            42
        );

        // ---------------------------------------------------------
        // Strongest matches
        // ---------------------------------------------------------

        const strongest = [...allPoints]
            .sort((a, b) =>
                b.similarity - a.similarity
            )
            .slice(0, 5);

        const list =
            document.getElementById(
                "strongest-matches"
            );

        list.innerHTML = "";

        strongest.forEach(point => {

            const li =
                document.createElement("li");

            li.textContent =
                `${point.a} ↔ ${point.b}: ` +
                point.similarity.toFixed(3);

            list.appendChild(li);
        });

        status.textContent =
            `Figure generated from ${names.length} Marvel character pages.`;

    } catch (error) {

        console.error(error);

        status.textContent =
            "The figure could not be generated automatically. " +
            "Check the browser console for details.";

    }
}

document.addEventListener(
    "DOMContentLoaded",
    buildFigure
);
