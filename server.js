const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

let currentAppTitle = "PROFED 5 GROUP 2 QUICK ACTIVITY";
let currentQuizMode = "multiple-choice";
let currentGameMode = "group"; // "group" o "individual"
let isGameStarted = false;

// Group & Individual State Storage
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };

let individualParticipants = {}; // { socketId: { fullName, photo, score, completed, timestamp } }

let timerInterval = null;
let serverPhotoArchive = [];
let groupScoreHistory = [];
let individualScoreHistory = [];

let judgePopupQueue = [];

let customQuestionsList = [
    {
        question: "Ayon sa Kautusang Pampamahalaan at Code of Ethics, ano ang pangunahing batayan ng pagpaparusa o pagdidisiplina ng isang guro sa mag-aaral?",
        type: "multiple-choice",
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

function evaluateSmartEssayScore(essayText, questionText, criteriaText, maxPoints) {
    if (!essayText || typeof essayText !== 'string') return 0;
    let text = essayText.trim().toLowerCase();
    if (text.length < 10) return 0;
    let maxScore = maxPoints || 10;
    let combinedContext = ((questionText || "") + " " + (criteriaText || "")).toLowerCase();
    let words = combinedContext.match(/\b[a-zà-ÿ0-9]{4,}\b/gi) || [];
    let stopWords = new Set(['e.g.', 'type', 'points', 'para', 'sa', 'mga', 'nang', 'maging', 'dahil', 'ayon', 'kundi', 'rubrics', 'criteria']);
    let coreKeywords = Array.from(new Set(words.filter(w => !stopWords.has(w))));

    let matchCount = 0;
    coreKeywords.forEach(kw => { if (text.includes(kw)) matchCount++; });
    let relevanceRatio = coreKeywords.length > 0 ? (matchCount / coreKeywords.length) : 0.5;
    if (coreKeywords.length >= 3 && matchCount === 0) return 0;

    let wordCount = text.split(/\s+/).length;
    let lengthScoreRatio = wordCount >= 30 ? 1.0 : (wordCount >= 15 ? 0.7 : (wordCount >= 8 ? 0.4 : 0.2));
    let finalRatio = (relevanceRatio * 0.6) + (lengthScoreRatio * 0.4);
    if (finalRatio < 0.25) return 0;
    let computedPoints = Math.round(finalRatio * maxScore);
    return Math.min(Math.max(computedPoints, 0), maxScore);
}

io.on('connection', (socket) => {
    socket.emit('titleUpdated', currentAppTitle);
    socket.emit('quizModeUpdated', currentQuizMode);
    socket.emit('gameModeUpdated', currentGameMode);
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, currentGameMode });
    socket.emit('applyCustomQuestionsList', customQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('historyUpdated', { groupScoreHistory, individualScoreHistory });

    socket.on('changeAppTitle', (newTitle) => {
        currentAppTitle = newTitle;
        io.emit('titleUpdated', currentAppTitle);
    });

    socket.on('changeQuizMode', (mode) => {
        currentQuizMode = mode;
        io.emit('quizModeUpdated', currentQuizMode);
    });

    socket.on('changeGameMode', (mode) => {
        currentGameMode = mode;
        io.emit('gameModeUpdated', currentGameMode);
    });

    socket.on('updatePlainQuestionsData', (questionsList) => {
        if (questionsList && questionsList.length > 0) {
            customQuestionsList = questionsList;
            io.emit('applyCustomQuestionsList', customQuestionsList);
        }
    });

    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (groupName && photo) {
            attorneyPhotos[groupName] = photo;
            let timeStr = new Date().toLocaleTimeString();
            let dateStr = new Date().toLocaleDateString();
            serverPhotoArchive.push({
                id: 'photo_' + Date.now() + Math.random().toString(36.substring(2, 7)),
                groupName,
                photo,
                timestamp: `${dateStr} ${timeStr}`
            });
            judgePopupQueue.push({ groupName, photo });
            io.emit('showJudgePopupQueue', judgePopupQueue);
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, currentGameMode });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
        }
    });

    socket.on('registerIndividualParticipant', ({ fullName, photo }) => {
        if (fullName && photo) {
            individualParticipants[socket.id] = {
                fullName,
                photo,
                score: 0,
                completed: false,
                timestamp: new Date().toLocaleTimeString()
            };
            judgePopupQueue.push({ groupName: fullName, photo });
            io.emit('showJudgePopupQueue', judgePopupQueue);
            let timeStr = new Date().toLocaleTimeString();
            let dateStr = new Date().toLocaleDateString();
            serverPhotoArchive.push({
                id: 'photo_' + Date.now() + Math.random().toString(36.substring(2, 7)),
                groupName: fullName,
                photo,
                timestamp: `${dateStr} ${timeStr}`
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, currentGameMode });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
        }
    });

    socket.on('startTimer', () => {
        isGameStarted = true;
        io.emit('gameState', { isGameStarted });

        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            let activeCount = 0;
            if (currentGameMode === 'group') {
                Object.keys(groupTimers).forEach(g => {
                    if (!groupCompletedStatus[g] && groupTimers[g] > 0) {
                        groupTimers[g]--;
                        activeCount++;
                    }
                });
                io.emit('timerUpdate', groupTimers);
                const allFinished = Object.keys(groupTimers).every(g => groupTimers[g] <= 0 || groupCompletedStatus[g]);
                if (activeCount === 0 || allFinished) {
                    clearInterval(timerInterval);
                    recordHistoryAndFinish();
                    io.emit('timeUp');
                }
            } else {
                // Individual mode global timer or check
                io.emit('timerUpdate', groupTimers);
            }
        }, 1000);
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        if (currentGameMode === 'group') {
            Object.keys(groupTimers).forEach(g => { groupTimers[g] = 0; });
            io.emit('timerUpdate', groupTimers);
        }
        recordHistoryAndFinish();
        io.emit('timeUp');
    });

    socket.on('setTimerDuration', (seconds) => {
        Object.keys(groupTimers).forEach(g => { groupTimers[g] = seconds; });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('submitAnswer', ({ groupName, questionIndex, answer, answeredCount }) => {
        let qObj = customQuestionsList[questionIndex];
        let earnedPoints = 0;
        let isCorrect = false;

        if (qObj) {
            if (qObj.type === 'essay') {
                earnedPoints = evaluateSmartEssayScore(answer, qObj.question, qObj.rubrics || qObj.explanation, qObj.points || 10);
                isCorrect = earnedPoints > 0;
            } else {
                let cleanUserAns = String(answer).trim().toLowerCase();
                let cleanCorrectAns = String(qObj.answer).trim().toLowerCase();
                if (cleanUserAns === cleanCorrectAns || (cleanCorrectAns !== 'n/a' && cleanUserAns.includes(cleanCorrectAns))) {
                    isCorrect = true;
                    earnedPoints = qObj.points || 1;
                    if (currentGameMode === 'group' && groupTimers[groupName] !== undefined) {
                        groupTimers[groupName] += 5;
                    }
                } else {
                    earnedPoints = 0;
                    isCorrect = false;
                }
            }
        }

        socket.emit('answerFeedback', { 
            isCorrect, 
            questionId: `q${questionIndex + 1}`, 
            answer, 
            earnedPoints, 
            maxPoints: qObj ? (qObj.points || 1) : 1,
            qType: qObj ? qObj.type : 'multiple-choice'
        });

        if (currentGameMode === 'group') {
            if (groupScores[groupName] !== undefined && !groupCompletedStatus[groupName]) {
                groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
                if (answeredCount >= customQuestionsList.length) {
                    groupCompletedStatus[groupName] = true;
                    io.emit('groupFinished', { groupName });
                }
                io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, currentGameMode });
                io.emit('timerUpdate', groupTimers);
            }
        } else {
            let p = individualParticipants[socket.id];
            if (p && !p.completed) {
                p.score = (p.score || 0) + earnedPoints;
                if (answeredCount >= customQuestionsList.length) {
                    p.completed = true;
                }
                io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, currentGameMode });
            }
        }
    });

    socket.on('resetGame', () => {
        if (timerInterval) clearInterval(timerInterval);
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
        individualParticipants = {};
        judgePopupQueue = [];
        io.emit('resetState');
    });

    socket.on('clearPhotoArchive', () => {
        serverPhotoArchive = [];
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });

    socket.on('deleteArchivePhoto', (photoId) => {
        serverPhotoArchive = serverPhotoArchive.filter(item => item.id !== photoId);
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });

    socket.on('disconnect', () => {
        if (individualParticipants[socket.id]) {
            delete individualParticipants[socket.id];
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, currentGameMode });
        }
    });
});

function recordHistoryAndFinish() {
    let timeStr = new Date().toLocaleTimeString();
    let dateStr = new Date().toLocaleDateString();
    let dateTimeStamp = `${dateStr} ${timeStr}`;

    Object.keys(groupScores).forEach(g => {
        groupScoreHistory.push({
            name: g,
            score: groupScores[g],
            dateTime: dateTimeStamp
        });
    });

    Object.values(individualParticipants).forEach(p => {
        individualScoreHistory.push({
            fullName: p.fullName,
            score: p.score,
            dateTime: dateTimeStamp
        });
    });

    io.emit('historyUpdated', { groupScoreHistory, individualScoreHistory });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});