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
let currentMode = "group"; // 'group' or 'individual'
let isGameStarted = false;
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
let timerInterval = null;
let serverPhotoArchive = [];

// Persistent History Archives
let groupScoreHistoryArchive = [];
let individualScoreHistoryArchive = [];
let individualParticipants = {}; 
let individualScores = {};       

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
    socket.emit('gameModeUpdated', currentMode);
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
    socket.emit('applyCustomQuestionsList', customQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('groupHistoryUpdated', groupScoreHistoryArchive);
    socket.emit('individualHistoryUpdated', individualScoreHistoryArchive);
    socket.emit('individualParticipantsUpdated', individualParticipants);
    socket.emit('individualScoresUpdated', individualScores);

    socket.on('setGameMode', (mode) => {
        currentMode = mode;
        io.emit('gameModeUpdated', currentMode);
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
    });

    socket.on('registerIndividualParticipant', ({ fullName, photo }) => {
        if (fullName) {
            individualParticipants[socket.id] = {
                fullName: fullName.trim(),
                photo: photo || '',
                score: 0,
                timestamp: new Date().toLocaleTimeString(),
                date: new Date().toLocaleDateString()
            };
            individualScores[fullName.trim()] = 0;
            io.emit('individualParticipantsUpdated', individualParticipants);
            io.emit('individualScoresUpdated', individualScores);
        }
    });

    socket.on('submitIndividualAnswer', ({ fullName, questionIndex, answer, answeredCount }, callback) => {
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
                }
            }
        }

        if (individualParticipants[socket.id]) {
            individualParticipants[socket.id].score = (individualParticipants[socket.id].score || 0) + earnedPoints;
            individualScores[individualParticipants[socket.id].fullName] = individualParticipants[socket.id].score;
            
            let existingIndex = individualScoreHistoryArchive.findIndex(item => item.fullName === individualParticipants[socket.id].fullName);
            if (existingIndex >= 0) {
                individualScoreHistoryArchive[existingIndex].score = individualParticipants[socket.id].score;
            } else {
                individualScoreHistoryArchive.push({
                    id: String(Date.now() + Math.random()),
                    fullName: individualParticipants[socket.id].fullName,
                    score: individualParticipants[socket.id].score,
                    date: new Date().toLocaleDateString(),
                    time: new Date().toLocaleTimeString()
                });
            }
        }

        io.emit('individualParticipantsUpdated', individualParticipants);
        io.emit('individualScoresUpdated', individualScores);
        io.emit('individualHistoryUpdated', individualScoreHistoryArchive);

        if (typeof callback === 'function') {
            callback({ isCorrect, earnedPoints, maxPoints: qObj ? (qObj.points || 1) : 1 });
        }
    });

    socket.on('deleteGroupHistoryItem', (id) => {
        groupScoreHistoryArchive = groupScoreHistoryArchive.filter(item => String(item.id) !== String(id));
        io.emit('groupHistoryUpdated', groupScoreHistoryArchive);
    });

    socket.on('deleteIndividualHistoryItem', (id) => {
        individualScoreHistoryArchive = individualScoreHistoryArchive.filter(item => String(item.id) !== String(id));
        io.emit('individualHistoryUpdated', individualScoreHistoryArchive);
    });

    socket.on('deleteArchivePhoto', (index) => {
        if (serverPhotoArchive && serverPhotoArchive[index] !== undefined) {
            serverPhotoArchive.splice(index, 1);
            io.emit('photoArchiveUpdated', serverPhotoArchive);
        }
    });

    socket.on('changeAppTitle', (newTitle) => {
        currentAppTitle = newTitle;
        io.emit('titleUpdated', currentAppTitle);
    });

    socket.on('changeQuizMode', (mode) => {
        currentQuizMode = mode;
        io.emit('quizModeUpdated', currentQuizMode);
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
                groupName,
                photo,
                timestamp: new Date().toLocaleTimeString()
            });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('newAttorneyJoined', { groupName, photo });
        }
    });

    socket.on('startTimer', () => {
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
            const allFinished = Object.keys(groupTimers).every(g => groupTimers[g] <= 0 || groupCompletedStatus[g]);
            if (activeCount === 0 || allFinished) {
                clearInterval(timerInterval);
                io.emit('timeUp');
            }
        }, 1000);
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        Object.keys(groupTimers).forEach(g => { groupTimers[g] = 0; });
        io.emit('timerUpdate', groupTimers);
        io.emit('timeUp');
    });

    socket.on('setTimerDuration', (seconds) => {
        Object.keys(groupTimers).forEach(g => { groupTimers[g] = seconds; });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('submitAnswer', ({ groupName, questionIndex, answer, answeredCount }) => {
        if (groupScores[groupName] !== undefined && !groupCompletedStatus[groupName]) {
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
                        if (groupTimers[groupName] !== undefined) {
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

            groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
            
            let gHistIndex = groupScoreHistoryArchive.findIndex(item => item.groupName === groupName);
            if (gHistIndex >= 0) {
                groupScoreHistoryArchive[gHistIndex].score = groupScores[groupName];
            } else {
                groupScoreHistoryArchive.push({
                    id: String(Date.now() + Math.random()),
                    groupName: groupName,
                    score: groupScores[groupName],
                    date: new Date().toLocaleDateString(),
                    time: new Date().toLocaleTimeString()
                });
            }

            if (answeredCount >= customQuestionsList.length) {
                groupCompletedStatus[groupName] = true;
            }

            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
            io.emit('timerUpdate', groupTimers);
            io.emit('groupHistoryUpdated', groupScoreHistoryArchive);

            const allCompleted = Object.keys(groupCompletedStatus).every(g => groupCompletedStatus[g]);
            if (allCompleted) {
                if (timerInterval) clearInterval(timerInterval);
                io.emit('timeUp');
            }
        }
    });

socket.on('resetGame', () => {
    isGameStarted = false;
    
    if (typeof groupTimers === 'object') {
        Object.keys(groupTimers).forEach(g => {
            groupTimers[g] = 300;
        });
    }

    if (typeof groupScores === 'object') {
        Object.keys(groupScores).forEach(g => {
            groupScores[g] = 0;
            if (attorneyPhotos) attorneyPhotos[g] = '';
            if (groupCompletedStatus) groupCompletedStatus[g] = false;
        });
    }

    if (typeof judgePopupQueue !== 'undefined') {
        judgePopupQueue = [];
    }

    io.emit('resetState');
    io.emit('gameState', { isGameStarted: false });
    
    if (typeof groupScores !== 'undefined' && typeof attorneyPhotos !== 'undefined') {
        io.emit('updateState', { 
            groupScores, 
            photos: attorneyPhotos, 
            completedStatus: groupCompletedStatus, 
            mode: typeof currentGlobalMode !== 'undefined' ? currentGlobalMode : 'group' 
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});