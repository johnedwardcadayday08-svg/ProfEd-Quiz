const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// I-serve ang mga static files mula sa root folder
app.use(express.static(path.join(__dirname)));

// Default data para sa laro
let currentAppTitle = "PROFED 5 GROUP 2 QUICK ACTIVITY";
let isGameStarted = false;
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
let timerInterval = null;
let serverPhotoArchive = [];
let gameMode = 'group';
let individualParticipants = {};
let individualScores = {};
let scoreHistory = [];
let nextArchiveId = 1;

// Default custom questions kung walang naka-insert
let customQuestionsList = [
    {
        question: "Ayon sa Kautusang Pampamahalaan at Code of Ethics, ano ang pangunahing batayan ng pagpaparusa o pagdidisiplina ng isang guro sa mag-aaral?",
        options: {
            A: "Pisikal na pananakit upang madaling matuto.",
            B: "Pagpapahiya sa harap ng klase para magsilbing aral.",
            C: "Nararapat, makatarungan, at naaayon sa batas na hakbang na naglalayong magturo at hindi manakit.",
            D: "Pagbawas ng malaking marka nang walang sapat na batayan."
        },
        answer: "C",
        explanation: "Ipinagbabawal sa mga guro ang corporal punishment o anumang uri ng pang-aabuso; ang disiplina ay dapat laging may paggalang sa dignidad ng bata."
    }
];

io.on('connection', (socket) => {
    // Ipadala ang kasalukuyang state sa bagong pasok na client
    socket.emit('titleUpdated', currentAppTitle);
    socket.emit('gameState', { isGameStarted });
    socket.emit('gameModeUpdated', gameMode);
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
    socket.emit('applyCustomQuestionsList', customQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('individualParticipantsUpdated', Object.values(individualParticipants));
    socket.emit('individualScoresUpdated', individualScores);
    socket.emit('scoreHistoryUpdated', scoreHistory);

    socket.on('setGameMode', (mode) => {
        if (mode === 'group' || mode === 'individual') {
            gameMode = mode;
            io.emit('gameModeUpdated', gameMode);
        }
    });

    socket.on('registerIndividualParticipant', ({ id, fullName, photo }) => {
        if (!id || !fullName || !photo) return;
        const participant = { id: String(id), fullName: String(fullName).slice(0, 100), photo, score: 0, joinedAt: new Date().toLocaleString() };
        individualParticipants[participant.id] = participant;
        individualScores[participant.id] = 0;
        serverPhotoArchive.push({
            id: nextArchiveId++,
            groupName: 'Individual',
            fullName: participant.fullName,
            participantId: participant.id,
            photo,
            timestamp: new Date().toLocaleString()
        });
        io.emit('individualParticipantsUpdated', Object.values(individualParticipants));
        io.emit('individualScoresUpdated', individualScores);
        io.emit('photoArchiveUpdated', serverPhotoArchive);
        io.emit('individualJoinPopup', participant);
    });

    socket.on('submitIndividualAnswer', ({ id, answeredCount }) => {
        if (!id || !individualParticipants[id]) return;
        individualScores[id] = Math.max(0, Number(answeredCount) || 0);
        individualParticipants[id].score = individualScores[id];
        io.emit('individualScoresUpdated', individualScores);
        io.emit('individualParticipantsUpdated', Object.values(individualParticipants));
    });

    socket.on('requestScoreHistory', () => {
        socket.emit('scoreHistoryUpdated', scoreHistory);
    });

    socket.on('deletePhotoArchiveItems', (ids) => {
        if (!Array.isArray(ids)) return;
        const wanted = new Set(ids.map(String));
        serverPhotoArchive = serverPhotoArchive.filter((item, index) =>
            !wanted.has(String(item.id ?? index))
        );
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });

    // Baguhin ang App Title
    socket.on('changeAppTitle', (newTitle) => {
        currentAppTitle = newTitle;
        io.emit('titleUpdated', currentAppTitle);
    });

    // I-update ang mga tanong mula sa Plain Text Parser
    socket.on('updatePlainQuestionsData', (questionsList) => {
        if (questionsList && questionsList.length > 0) {
            customQuestionsList = questionsList;
            io.emit('applyCustomQuestionsList', customQuestionsList);
        }
    });

    // Pagrehistro ng Attorney Photo at pagsali
    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (groupName && photo) {
            attorneyPhotos[groupName] = photo;
            serverPhotoArchive.push({
                id: nextArchiveId++,
                groupName,
                fullName: groupName,
                photo,
                timestamp: new Date().toLocaleString()
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('newAttorneyJoined', { groupName, photo });
        }
    });

    // Pagsisimula ng Timer at Laro
    socket.on('startTimer', () => {
        if (isGameStarted) return;
        isGameStarted = true;
        io.emit('gameState', { isGameStarted });

        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            let activeCount = 0;
            Object.keys(groupTimers).forEach(g => {
                if (!groupCompletedStatus[g] && groupTimers[g] > 0) {
                    groupTimers[g]--;
                    activeCount++;
                }
            });

            io.emit('timerUpdate', groupTimers);

            // Kung ang lahat ay tapos na o naubos na ang oras
            const allFinished = Object.keys(groupTimers).every(g => groupTimers[g] <= 0 || groupCompletedStatus[g]);
            if (activeCount === 0 || allFinished) {
                clearInterval(timerInterval);
                io.emit('timeUp');
            }
        }, 1000);
    });

    // Pag-set ng Timer Duration
    socket.on('setTimerDuration', (seconds) => {
        Object.keys(groupTimers).forEach(g => {
            groupTimers[g] = seconds;
        });
        io.emit('timerUpdate', groupTimers);
    });

    // Pagsagot sa Tanong
    socket.on('submitAnswer', ({ groupName, questionId, answer, answeredCount }) => {
        // Maaari mong lagyan dito ng logic para i-check kung tama ang sagot laban sa customQuestionsList
        // Sa kasalukuyan, binibilang nito ang iskor batay sa pagpasa ng sagot
        if (groupScores[groupName] !== undefined && !groupCompletedStatus[groupName]) {
            // Halimbawa: dagdag puntos kung sinagot
            groupScores[groupName] = answeredCount;
            
            // I-check kung nasagot na lahat ng tanong ng grupo na ito
            if (answeredCount >= customQuestionsList.length) {
                groupCompletedStatus[groupName] = true;
            }

            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });

            // Kung tapos na ang lahat ng grupo
            const allCompleted = Object.keys(groupCompletedStatus).every(g => groupCompletedStatus[g]);
            if (allCompleted) {
                if (timerInterval) clearInterval(timerInterval);
                io.emit('timeUp');
            }
        }
    });

    // I-reset ang Laro
    socket.on('resetGame', () => {
        if (timerInterval) clearInterval(timerInterval);
        const dateTime = new Date().toLocaleString();
        Object.entries(groupScores).forEach(([name, score]) => {
            if (Number(score) > 0) scoreHistory.push({ mode: 'group', name, groupName: name, score, total: customQuestionsList.length, dateTime });
        });
        Object.values(individualParticipants).forEach(p => {
            scoreHistory.push({ mode: 'individual', name: p.fullName, score: Number(individualScores[p.id] || 0), total: customQuestionsList.length, dateTime });
        });
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
        individualScores = {};
        individualParticipants = {};
        io.emit('individualParticipantsUpdated', []);
        io.emit('individualScoresUpdated', {});
        io.emit('scoreHistoryUpdated', scoreHistory);
        io.emit('photoArchiveUpdated', serverPhotoArchive);
        io.emit('resetState');
    });

    // Burahin ang Photo Archive
    socket.on('clearPhotoArchive', () => {
        serverPhotoArchive = [];
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
