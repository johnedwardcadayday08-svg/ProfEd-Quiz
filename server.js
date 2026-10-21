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
let currentGameModeType = "group"; // 'group' o 'individual'
let isGameStarted = false;

let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };

let individualParticipants = {}; // { socketId: { fullname, score, photo, completed, timer } }

let timerInterval = null;
let serverPhotoArchive = [];
let groupScoreHistoryArchive = [];
let individualScoreHistoryArchive = [];

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

    if (coreKeywords.length >= 3 && matchCount === 0) return 0;

    let wordCount = text.split(/\s+/).length;
    let lengthScoreRatio = wordCount >= 30 ? 1.0 : (wordCount >= 15 ? 0.7 : (wordCount >= 8 ? 0.4 : 0.2));
    let relevanceRatio = coreKeywords.length > 0 ? (matchCount / coreKeywords.length) : 0.5;
    let finalRatio = (relevanceRatio * 0.6) + (lengthScoreRatio * 0.4);

    if (finalRatio < 0.25) return 0;
    let computedPoints = Math.round(finalRatio * maxScore);
    return Math.min(Math.max(computedPoints, 0), maxScore);
}

io.on('connection', (socket) => {
    socket.emit('titleUpdated', currentAppTitle);
    socket.emit('quizModeUpdated', currentQuizMode);
    socket.emit('gameModeTypeUpdated', currentGameModeType);
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants });
    socket.emit('applyCustomQuestionsList', customQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('historyArchiveUpdated', { groupHistory: groupScoreHistoryArchive, individualHistory: individualScoreHistoryArchive });

    socket.on('changeAppTitle', (newTitle) => {
        currentAppTitle = newTitle;
        io.emit('titleUpdated', currentAppTitle);
    });

    socket.on('changeQuizMode', (mode) => {
        currentQuizMode = mode;
        io.emit('quizModeUpdated', currentQuizMode);
    });

    socket.on('changeGameModeType', (modeType) => {
        currentGameModeType = modeType;
        io.emit('gameModeTypeUpdated', currentGameModeType);
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
            serverPhotoArchive.push({
                id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                groupName,
                photo,
                timestamp: new Date().toLocaleString()
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('showJudgePopupQueue', [{ groupName, photo }]);
        }
    });

    socket.on('registerIndividualParticipant', ({ fullname, photo }) => {
        if (fullname && fullname.trim()) {
            individualParticipants[socket.id] = {
                id: socket.id,
                fullname: fullname.trim(),
                photo: photo || '',
                score: 0,
                completed: false,
                timer: 300
            };
            serverPhotoArchive.push({
                id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                groupName: fullname.trim(),
                photo: photo || '',
                timestamp: new Date().toLocaleString()
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('showJudgePopupQueue', [{ groupName: fullname.trim(), photo }]);
        }
    });

    socket.on('deleteSelectedArchivePhotos', (photoIds) => {
        if (Array.isArray(photoIds)) {
            serverPhotoArchive = serverPhotoArchive.filter(item => !photoIds.includes(item.id));
            io.emit('photoArchiveUpdated', serverPhotoArchive);
        }
    });

    socket.on('startTimer', () => {
        isGameStarted = true;
        io.emit('gameState', { isGameStarted });

        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            let activeCount = 0;
            if (currentGameModeType === 'group') {
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
                    saveHistoriesAndFinish();
                }
            } else {
                Object.keys(individualParticipants).forEach(id => {
                    if (!individualParticipants[id].completed && individualParticipants[id].timer > 0) {
                        individualParticipants[id].timer--;
                        activeCount++;
                    }
                });
                io.emit('individualTimerUpdate', individualParticipants);
                const allFinished = Object.keys(individualParticipants).length === 0 || Object.values(individualParticipants).every(p => p.timer <= 0 || p.completed);
                if (activeCount === 0 || allFinished) {
                    clearInterval(timerInterval);
                    saveHistoriesAndFinish();
                }
            }
        }, 1000);
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        if (currentGameModeType === 'group') {
            Object.keys(groupTimers).forEach(g => { groupTimers[g] = 0; });
            io.emit('timerUpdate', groupTimers);
        } else {
            Object.keys(individualParticipants).forEach(id => { individualParticipants[id].timer = 0; });
            io.emit('individualTimerUpdate', individualParticipants);
        }
        saveHistoriesAndFinish();
    });

    socket.on('setTimerDuration', (seconds) => {
        if (currentGameModeType === 'group') {
            Object.keys(groupTimers).forEach(g => { groupTimers[g] = seconds; });
            io.emit('timerUpdate', groupTimers);
        } else {
            Object.keys(individualParticipants).forEach(id => { individualParticipants[id].timer = seconds; });
            io.emit('individualTimerUpdate', individualParticipants);
        }
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
                    if (currentGameModeType === 'group') {
                        if (groupTimers[groupName] !== undefined) groupTimers[groupName] += 5;
                    } else {
                        if (individualParticipants[socket.id]) individualParticipants[socket.id].timer += 5;
                    }
                } else {
                    earnedPoints = 0;
                    isCorrect = false;
                }
            }
        }

        if (currentGameModeType === 'group') {
            if (groupScores[groupName] !== undefined && !groupCompletedStatus[groupName]) {
                groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
                if (answeredCount >= customQuestionsList.length) groupCompletedStatus[groupName] = true;

                socket.emit('answerFeedback', { isCorrect, questionId: `q${questionIndex + 1}`, answer, earnedPoints, maxPoints: qObj ? (qObj.points || 1) : 1, qType: qObj ? qObj.type : 'multiple-choice' });
                io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants });
                io.emit('timerUpdate', groupTimers);

                if (Object.keys(groupCompletedStatus).every(g => groupCompletedStatus[g])) {
                    if (timerInterval) clearInterval(timerInterval);
                    saveHistoriesAndFinish();
                }
            }
        } else {
            let participant = individualParticipants[socket.id];
            if (participant && !participant.completed) {
                participant.score = (participant.score || 0) + earnedPoints;
                if (answeredCount >= customQuestionsList.length) participant.completed = true;

                socket.emit('answerFeedback', { isCorrect, questionId: `q${questionIndex + 1}`, answer, earnedPoints, maxPoints: qObj ? (qObj.points || 1) : 1, qType: qObj ? qObj.type : 'multiple-choice' });
                io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants });

                if (Object.values(individualParticipants).length > 0 && Object.values(individualParticipants).every(p => p.completed)) {
                    if (timerInterval) clearInterval(timerInterval);
                    saveHistoriesAndFinish();
                }
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
        io.emit('resetState');
    });

    socket.on('clearPhotoArchive', () => {
        serverPhotoArchive = [];
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });

    socket.on('disconnect', () => {
        if (individualParticipants[socket.id]) {
            delete individualParticipants[socket.id];
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants });
        }
    });
});

function saveHistoriesAndFinish() {
    let dateTimeStr = new Date().toLocaleString();
    if (currentGameModeType === 'group') {
        Object.entries(groupScores).forEach(([grp, score]) => {
            let maxP = customQuestionsList.reduce((acc, q) => acc + (q.points || 1), 0);
            groupScoreHistoryArchive.push({
                name: grp,
                score: `${score}/${maxP}`,
                datetime: dateTimeStr
            });
        });
    } else {
        Object.values(individualParticipants).forEach(p => {
            let maxP = customQuestionsList.reduce((acc, q) => acc + (q.points || 1), 0);
            individualScoreHistoryArchive.push({
                name: p.fullname,
                score: `${p.score}/${maxP}`,
                datetime: dateTimeStr
            });
        });
    }
    io.emit('historyArchiveUpdated', { groupHistory: groupScoreHistoryArchive, individualHistory: individualScoreHistoryArchive });
    io.emit('timeUp');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});