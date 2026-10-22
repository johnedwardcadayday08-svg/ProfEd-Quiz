const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware para sa static files (suportado ang public folder o root folder)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Explicit route para maiwasan ang "Cannot GET /" error
app.get('/', (req, res) => {
    let publicPath = path.join(__dirname, 'public', 'index.html');
    let rootPath = path.join(__dirname, 'index.html');
    
    // Unang hahanapin sa public folder, kung wala ay sa root folder
    res.sendFile(publicPath, (err) => {
        if (err) {
            res.sendFile(rootPath, (err2) => {
                if (err2) {
                    res.status(404).send("Error: Hindi makita ang index.html file mo. Siguraduhing nailagay ito sa tamang folder.");
                }
            });
        }
    });
});

// Persistent Memory
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let individualScores = {};
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };

let isGameStarted = false;
let currentQuizMode = 'multiple-choice';
let currentAppTitle = 'PROFED 5 GROUP 2 QUICK ACTIVITY';
let defaultTimerDuration = 300;

let persistentCustomQuestions = null; // Nililigtas ang in-insert na tanong
let groupScoreHistory = [];          // Nililigtas ang natapos na group games (Date & Time)
let photoArchive = [];               // Picture Archive

let timerInterval = null;

io.on('connection', (socket) => {
    // I-sync ang kasalukuyang status sa bagong kumonekta
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
    socket.emit('quizModeUpdated', currentQuizMode);
    socket.emit('titleUpdated', currentAppTitle);
    socket.emit('photoArchiveUpdated', photoArchive);
    socket.emit('groupHistoryUpdated', groupScoreHistory);
    socket.emit('individualScoresUpdated', individualScores);

    // I-send ang nakatagong custom questions kung mayroon
    if (persistentCustomQuestions) {
        socket.emit('applyCustomQuestionsList', persistentCustomQuestions);
    }

    // 1. Pag-save ng In-insert na Tanong sa Server
    socket.on('updatePlainQuestionsData', (questionsList) => {
        persistentCustomQuestions = questionsList;
        io.emit('applyCustomQuestionsList', questionsList);
    });

    // 2. Pagpapalit ng Quiz Mode & Title & Timer Duration
    socket.on('changeQuizMode', (mode) => {
        currentQuizMode = mode;
        io.emit('quizModeUpdated', mode);
    });

    socket.on('changeAppTitle', (title) => {
        currentAppTitle = title;
        io.emit('titleUpdated', title);
    });

    socket.on('setTimerDuration', (seconds) => {
        defaultTimerDuration = seconds;
        Object.keys(groupTimers).forEach(g => {
            groupTimers[g] = seconds;
        });
        io.emit('timerUpdate', groupTimers);
    });

    // 3. Registration ng Participants / Photos
    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (attorneyPhotos[groupName] !== undefined) {
            attorneyPhotos[groupName] = photo;
            
            // I-save sa archive
            let timestamp = new Date().toLocaleString();
            photoArchive.push({ groupName, photo, timestamp });
            
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
            io.emit('photoArchiveUpdated', photoArchive);
            io.emit('newAttorneyJoined', { groupName, photo });
        }
    });

    socket.on('registerIndividualParticipant', ({ fullName, photo }) => {
        if (fullName) {
            if (individualScores[fullName] === undefined) {
                individualScores[fullName] = 0;
            }
            if (photo) {
                let timestamp = new Date().toLocaleString();
                photoArchive.push({ groupName: fullName, photo, timestamp });
                io.emit('photoArchiveUpdated', photoArchive);
            }
            io.emit('individualScoresUpdated', individualScores);
        }
    });

    // 4. Timer Controls
    socket.on('startTimer', () => {
        isGameStarted = true;
        io.emit('gameState', { isGameStarted: true });

        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            let allFinished = true;
            Object.keys(groupTimers).forEach(g => {
                if (groupTimers[g] > 0 && !groupCompletedStatus[g]) {
                    groupTimers[g]--;
                    allFinished = false;
                }
            });

            io.emit('timerUpdate', groupTimers);

            if (allFinished) {
                clearInterval(timerInterval);
                saveGroupScoreHistory();
                io.emit('timeUp');
            }
        }, 1000);
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        Object.keys(groupTimers).forEach(g => groupTimers[g] = 0);
        io.emit('timerUpdate', groupTimers);
        saveGroupScoreHistory();
        io.emit('timeUp');
    });

    // 5. Pag-submit ng Sagot (Group Mode)
    socket.on('submitAnswer', ({ groupName, questionIndex, answer, answeredCount }) => {
        if (!isGameStarted) return;

        let q = persistentCustomQuestions ? persistentCustomQuestions[questionIndex] : null;
        let isCorrect = false;
        let earnedPoints = 0;
        let maxPoints = q ? (q.points || 1) : 1;
        let qType = q ? q.type : 'multiple-choice';

        if (q) {
            if (qType === 'essay') {
                earnedPoints = Math.floor(Math.random() * (maxPoints - Math.floor(maxPoints / 2) + 1)) + Math.floor(maxPoints / 2);
                groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
            } else {
                let cleanUserAns = String(answer).trim().toLowerCase();
                let cleanTargetAns = String(q.answer).trim().toLowerCase();

                if (cleanUserAns === cleanTargetAns || (q.options && q.options[answer] && q.options[answer].toLowerCase() === cleanTargetAns)) {
                    isCorrect = true;
                    earnedPoints = maxPoints;
                    groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
                    groupTimers[groupName] = (groupTimers[groupName] || 0) + 5; // +5s Bonus
                }
            }
        }

        socket.emit('answerFeedback', { isCorrect, questionId: `q${questionIndex + 1}`, answer, earnedPoints, maxPoints, qType });
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });

        // Tiyakin kung tapos na ang lahat ng tanong
        if (persistentCustomQuestions && answeredCount >= persistentCustomQuestions.length) {
            groupCompletedStatus[groupName] = true;
            io.emit('groupFinished', { groupName });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
        }
    });

    // 6. Pag-submit ng Sagot (Individual Mode)
    socket.on('submitIndividualAnswer', ({ fullName, questionIndex, answer, answeredCount }, callback) => {
        if (!isGameStarted || !fullName) return;

        let q = persistentCustomQuestions ? persistentCustomQuestions[questionIndex] : null;
        let isCorrect = false;
        let earnedPoints = 0;
        let maxPoints = q ? (q.points || 1) : 1;
        let qType = q ? q.type : 'multiple-choice';

        if (q) {
            if (qType === 'essay') {
                earnedPoints = Math.floor(Math.random() * (maxPoints - Math.floor(maxPoints / 2) + 1)) + Math.floor(maxPoints / 2);
                individualScores[fullName] = (individualScores[fullName] || 0) + earnedPoints;
            } else {
                let cleanUserAns = String(answer).trim().toLowerCase();
                let cleanTargetAns = String(q.answer).trim().toLowerCase();

                if (cleanUserAns === cleanTargetAns || (q.options && q.options[answer] && q.options[answer].toLowerCase() === cleanTargetAns)) {
                    isCorrect = true;
                    earnedPoints = maxPoints;
                    individualScores[fullName] = (individualScores[fullName] || 0) + earnedPoints;
                }
            }
        }

        io.emit('individualScoresUpdated', individualScores);

        if (callback) {
            callback({ isCorrect, earnedPoints, maxPoints });
        }
    });

    // 7. Delete History Events
    socket.on('deleteGroupHistory', (index) => {
        if (index >= 0 && index < groupScoreHistory.length) {
            groupScoreHistory.splice(index, 1);
            io.emit('groupHistoryUpdated', groupScoreHistory);
        }
    });

    socket.on('deleteIndividualHistory', (index) => {
        let entries = Object.entries(individualScores);
        if (index >= 0 && index < entries.length) {
            entries.splice(index, 1);
            individualScores = Object.fromEntries(entries);
            io.emit('individualScoresUpdated', individualScores);
        }
    });

    // 8. Delete Picture Archive
    socket.on('deleteArchivePhoto', (index) => {
        if (index >= 0 && index < photoArchive.length) {
            photoArchive.splice(index, 1);
            io.emit('photoArchiveUpdated', photoArchive);
        }
    });

    socket.on('clearPhotoArchive', () => {
        photoArchive = [];
        io.emit('photoArchiveUpdated', photoArchive);
    });

    // 9. Reset Game
    socket.on('resetGame', () => {
        if (timerInterval) clearInterval(timerInterval);
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        Object.keys(groupTimers).forEach(g => groupTimers[g] = defaultTimerDuration);

        io.emit('resetState');
        io.emit('gameState', { isGameStarted: false });
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
        io.emit('timerUpdate', groupTimers);
    });

    function saveGroupScoreHistory() {
        let timestamp = new Date().toLocaleString();
        let totalMaxScore = persistentCustomQuestions ? persistentCustomQuestions.reduce((acc, q) => acc + (q.points || 1), 0) : 10;
        
        Object.entries(groupScores).forEach(([group, score]) => {
            if (score > 0 || attorneyPhotos[group]) {
                groupScoreHistory.push({ groupName: group, score, maxScore: totalMaxScore, timestamp });
            }
        });
        io.emit('groupHistoryUpdated', groupScoreHistory);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Courtroom Quiz Server is running on port ${PORT}`);
});