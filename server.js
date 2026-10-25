const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Siguraduhing maayos ang Socket.io initialization
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware para sa static files (HTML, CSS, Images)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Global State Variables
let currentQuizMode = 'multiple-choice';
let currentGameMode = 'group';
let isGameStarted = false;
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let individualScores = {};
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let individualParticipants = {};
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let individualCompletedStatus = {};
let questionsList = [];
let photoArchive = [];
let groupHistory = [];
let individualHistory = [];

// ==========================================
// MATALINONG PAG-SCORING AT TEXT NORMALIZATION
// ==========================================

function normalizeText(str) {
    if (!str) return "";
    return str
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^\w\s]/gi, '') // Tinatanggal ang mga simbolo at kuwit
        .replace(/\s+/g, ' ');   // Ginagawang iisang space ang paulit-ulit na space
}

function isAnswerCorrect(userAns, correctAns) {
    const cleanUser = normalizeText(userAns);
    const cleanCorrect = normalizeText(correctAns);

    if (!cleanUser) return false;

    // 1. Exact match pagkatapos linisin ang spaces at capitalization
    if (cleanUser === cleanCorrect) return true;

    // 2. Flexible match (kung nakapaloob ang sagot sa criteria)
    if (cleanUser.length >= 3 && cleanCorrect.includes(cleanUser)) return true;
    if (cleanCorrect.length >= 3 && cleanUser.includes(cleanCorrect)) return true;

    // 3. Suporta para sa maramihang posibleng tamang sagot (e.g. "Manila / Maynila")
    if (correctAns.includes('/') || correctAns.includes(',')) {
        const validAnswers = correctAns.split(/[/,]/).map(a => normalizeText(a));
        return validAnswers.some(ans => ans === cleanUser || (ans.length >= 3 && cleanUser.includes(ans)));
    }

    return false;
}

// ==========================================
// REAL-TIME SOCKET.IO EVENTS
// ==========================================

io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // I-sync ang paunang data sa bagong konektadong client
    socket.emit('updateState', {
        groupScores: groupScores,
        photos: attorneyPhotos,
        completedStatus: groupCompletedStatus
    });
    socket.emit('gameModeUpdated', currentGameMode);
    socket.emit('quizModeUpdated', currentQuizMode);
    socket.emit('photoArchiveUpdated', photoArchive);
    socket.emit('groupHistoryUpdated', groupHistory);
    socket.emit('individualHistoryUpdated', individualHistory);
    if (questionsList.length > 0) {
        socket.emit('applyCustomQuestionsList', questionsList);
    }

    // Set Game Mode (Group vs Individual)
    socket.on('setGameMode', (mode) => {
        currentGameMode = mode;
        io.emit('gameModeUpdated', mode);
    });

    // Set Quiz Mode (Multiple Choice / Mixed / Long Essay)
    socket.on('changeQuizMode', (mode) => {
        currentQuizMode = mode;
        io.emit('quizModeUpdated', mode);
    });

    // Bagong Tanong mula sa Plain Text Insert
    socket.on('updatePlainQuestionsData', (newList) => {
        questionsList = newList;
        io.emit('applyCustomQuestionsList', questionsList);
    });

    // Pagsali ng Attorney / Group Photo
    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        attorneyPhotos[groupName] = photo;
        if (photo) {
            photoArchive.push({
                groupName: groupName,
                photo: photo,
                timestamp: new Date().toLocaleString()
            });
            io.emit('photoArchiveUpdated', photoArchive);
            io.emit('newAttorneyJoined', { groupName, photo });
        }
        io.emit('updateState', {
            groupScores: groupScores,
            photos: attorneyPhotos,
            completedStatus: groupCompletedStatus
        });
    });

    // Pagsali ng Individual Participant
    socket.on('registerIndividualParticipant', ({ fullName, photo }) => {
        if (!fullName) return;
        individualParticipants[socket.id] = { fullName, photo };
        if (!individualScores[fullName]) {
            individualScores[fullName] = 0;
        }
        if (photo) {
            photoArchive.push({
                groupName: fullName,
                photo: photo,
                timestamp: new Date().toLocaleString()
            });
            io.emit('photoArchiveUpdated', photoArchive);
        }
        io.emit('individualParticipantsUpdated', individualParticipants);
        io.emit('individualScoresUpdated', {
            scores: individualScores,
            completedStatus: individualCompletedStatus
        });
    });

    // Matalinong Pagpasa ng Sagot (Submit Answer)
    socket.on('submitAnswer', ({ groupName, questionIndex, answer }) => {
        if (!questionsList[questionIndex]) return;

        const currentQ = questionsList[questionIndex];
        let isCorrect = false;
        let earnedPoints = 0;

        const qType = (currentQ.type || 'multiple-choice').toLowerCase();

        if (qType === 'multiple-choice' || qType === 'true-false') {
            isCorrect = normalizeText(answer) === normalizeText(currentQ.answer);
            earnedPoints = isCorrect ? (currentQ.points || 1) : 0;
        } else {
            // Matalinong pag-score para sa Essay at Identification
            isCorrect = isAnswerCorrect(answer, currentQ.answer);
            earnedPoints = isCorrect ? (currentQ.points || 1) : 0;
        }

        // I-update ang Score sa tamang Mode
        if (currentGameMode === 'individual') {
            individualScores[groupName] = (individualScores[groupName] || 0) + earnedPoints;
            io.emit('individualScoresUpdated', {
                scores: individualScores,
                completedStatus: individualCompletedStatus
            });
        } else {
            groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
            if (isCorrect && groupTimers[groupName] !== undefined) {
                groupTimers[groupName] += 5; // +5 Seconds Bonus
            }
            io.emit('updateState', {
                groupScores: groupScores,
                photos: attorneyPhotos,
                completedStatus: groupCompletedStatus
            });
        }

        // Magpadala ng feedback pabalik sa participant
        socket.emit('answerFeedback', {
            isCorrect: isCorrect,
            earnedPoints: earnedPoints
        });
    });

    // Simulan ang Quiz
    socket.on('startQuiz', () => {
        isGameStarted = true;
        io.emit('quizStartedSignal');
    });

    // Simulan / I-update ang Timer
    socket.on('startTimer', () => {
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('setTimerDuration', (seconds) => {
        Object.keys(groupTimers).forEach(g => {
            groupTimers[g] = seconds;
        });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('forceTimeUp', () => {
        io.emit('timeUp');
    });

    // Reset Game
    socket.on('resetGame', () => {
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        individualScores = {};
        groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        individualCompletedStatus = {};
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };

        io.emit('resetState');
        io.emit('updateState', {
            groupScores: groupScores,
            photos: attorneyPhotos,
            completedStatus: groupCompletedStatus
        });
        io.emit('individualScoresUpdated', {
            scores: individualScores,
            completedStatus: individualCompletedStatus
        });
    });

    // Baguhin ang Title sa Screen
    socket.on('changeAppTitle', (newTitle) => {
        io.emit('titleUpdated', newTitle);
    });

    // Archive & History Management
    socket.on('deleteArchivePhoto', (index) => {
        if (photoArchive[index]) {
            photoArchive.splice(index, 1);
            io.emit('photoArchiveUpdated', photoArchive);
        }
    });

    socket.on('clearPhotoArchive', () => {
        photoArchive = [];
        io.emit('photoArchiveUpdated', photoArchive);
    });

    socket.on('deleteGroupHistoryItem', (id) => {
        groupHistory = groupHistory.filter(item => item.id !== id);
        io.emit('groupHistoryUpdated', groupHistory);
    });

    socket.on('deleteIndividualHistoryItem', (id) => {
        individualHistory = individualHistory.filter(item => item.id !== id);
        io.emit('individualHistoryUpdated', individualHistory);
    });

    socket.on('disconnect', () => {
        delete individualParticipants[socket.id];
        console.log(`❌ Client disconnected: ${socket.id}`);
    });
});

// ==========================================
// RENDER PORT BINDING & SERVER LISTEN
// ==========================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is successfully running on port ${PORT}`);
});