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
let currentGameMode = "group";
let isGameStarted = false;
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
let timerInterval = null;
let serverPhotoArchive = [];

let individualParticipants = {};
let groupScoreHistory = [];
let individualScoreHistory = [];

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
    coreKeywords.forEach(kw => {
        if (text.includes(kw)) matchCount++;
    });

    let relevanceRatio = coreKeywords.length > 0 ? (matchCount / coreKeywords.length) : 0.5;

    if (coreKeywords.length >= 3 && matchCount === 0) {
        return 0;
    }

    let wordCount = text.split(/\s+/).length;
    let lengthScoreRatio = 0;
    if (wordCount >= 30) lengthScoreRatio = 1.0;
    else if (wordCount >= 15) lengthScoreRatio = 0.7;
    else if (wordCount >= 8) lengthScoreRatio = 0.4;
    else lengthScoreRatio = 0.2;

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
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
    socket.emit('applyCustomQuestionsList', customQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('scoreHistoryUpdated', { groupScoreHistory, individualScoreHistory });

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
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
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
            let photoId = Date.now() + Math.random().toString(36).substr(2, 5);
            serverPhotoArchive.push({
                id: photoId,
                groupName,
                photo,
                timestamp: new Date().toLocaleTimeString()
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('newAttorneyJoined', { groupName, photo });
            io.emit('triggerJudgePopup', { groupName, photo });
        }
    });

    socket.on('registerIndividualParticipant', ({ fullName, photo }) => {
        if (fullName && photo) {
            let pId = socket.id;
            individualParticipants[pId] = { id: pId, name: fullName, score: 0, photo: photo, completed: false, timer: 300 };
            let photoId = Date.now() + Math.random().toString(36).substr(2, 5);
            serverPhotoArchive.push({
                id: photoId,
                groupName: fullName,
                photo,
                timestamp: new Date().toLocaleTimeString()
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('triggerJudgePopup', { groupName: fullName, photo });
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
                    io.emit('timeUp');
                }
            } else {
                Object.keys(individualParticipants).forEach(pId => {
                    let p = individualParticipants[pId];
                    if (!p.completed && p.timer > 0) {
                        p.timer--;
                        activeCount++;
                    }
                });
                io.emit('timerUpdate', groupTimers);
                const allIndivFinished = Object.keys(individualParticipants).length > 0 && Object.keys(individualParticipants).every(pId => individualParticipants[pId].timer <= 0 || individualParticipants[pId].completed);
                if (activeCount === 0 || allIndivFinished) {
                    clearInterval(timerInterval);
                    io.emit('timeUp');
                }
            }
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
        }, 1000);
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        if (currentGameMode === 'group') {
            Object.keys(groupTimers).forEach(g => { groupTimers[g] = 0; });
        } else {
            Object.keys(individualParticipants).forEach(pId => { individualParticipants[pId].timer = 0; });
        }
        io.emit('timerUpdate', groupTimers);
        io.emit('timeUp');
    });

    socket.on('setTimerDuration', (seconds) => {
        if (currentGameMode === 'group') {
            Object.keys(groupTimers).forEach(g => { groupTimers[g] = seconds; });
        } else {
            Object.keys(individualParticipants).forEach(pId => { individualParticipants[pId].timer = seconds; });
        }
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
                } else {
                    earnedPoints = 0;
                    isCorrect = false;
                }
            }
        }

        let maxScoreTotal = customQuestionsList.reduce((acc, q) => acc + (q.points || 1), 0);

        if (currentGameMode === 'group' && groupName && groupScores[groupName] !== undefined && !groupCompletedStatus[groupName]) {
            if (isCorrect && qObj.type !== 'essay' && groupTimers[groupName] !== undefined) {
                groupTimers[groupName] += 5;
            }
            groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
            
            if (answeredCount >= customQuestionsList.length) {
                groupCompletedStatus[groupName] = true;
                groupScoreHistory.push({
                    groupName,
                    score: groupScores[groupName],
                    maxScore: maxScoreTotal,
                    date: new Date().toLocaleDateString(),
                    time: new Date().toLocaleTimeString()
                });
                io.emit('scoreHistoryUpdated', { groupScoreHistory, individualScoreHistory });
            }

            socket.emit('answerFeedback', { 
                isCorrect, 
                questionId: `q${questionIndex + 1}`, 
                answer, 
                earnedPoints, 
                maxPoints: qObj ? (qObj.points || 1) : 1,
                qType: qObj ? qObj.type : 'multiple-choice'
            });

            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
            io.emit('timerUpdate', groupTimers);

            const allCompleted = Object.keys(groupCompletedStatus).every(g => groupCompletedStatus[g]);
            if (allCompleted) {
                if (timerInterval) clearInterval(timerInterval);
                io.emit('timeUp');
            }
        } else if (currentGameMode === 'individual' && socket.id && individualParticipants[socket.id]) {
            let p = individualParticipants[socket.id];
            if (!p.completed) {
                if (isCorrect && qObj.type !== 'essay') {
                    p.timer += 5;
                }
                p.score += earnedPoints;

                if (answeredCount >= customQuestionsList.length) {
                    p.completed = true;
                    individualScoreHistory.push({
                        name: p.name,
                        score: p.score,
                        maxScore: maxScoreTotal,
                        date: new Date().toLocaleDateString(),
                        time: new Date().toLocaleTimeString()
                    });
                    io.emit('scoreHistoryUpdated', { groupScoreHistory, individualScoreHistory });
                }

                socket.emit('answerFeedback', { 
                    isCorrect, 
                    questionId: `q${questionIndex + 1}`, 
                    answer, 
                    earnedPoints, 
                    maxPoints: qObj ? (qObj.points || 1) : 1,
                    qType: qObj ? qObj.type : 'multiple-choice'
                });

                io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
                io.emit('timerUpdate', groupTimers);

                const allIndivCompleted = Object.keys(individualParticipants).length > 0 && Object.keys(individualParticipants).every(pId => individualParticipants[pId].completed);
                if (allIndivCompleted) {
                    if (timerInterval) clearInterval(timerInterval);
                    io.emit('timeUp');
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
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, individualParticipants, gameMode: currentGameMode });
    });

    socket.on('clearPhotoArchive', () => {
        serverPhotoArchive = [];
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });

    socket.on('deleteSelectedPhotos', (photoIds) => {
        if (Array.isArray(photoIds)) {
            serverPhotoArchive = serverPhotoArchive.filter(item => !photoIds.includes(item.id));
            io.emit('photoArchiveUpdated', serverPhotoArchive);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});