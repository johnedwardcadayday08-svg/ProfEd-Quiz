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
let isGameStarted = false;
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
let timerInterval = null;
let serverPhotoArchive = [];

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

// AUTOMATIC RUBRICS SCORING ENGINE FOR ESSAYS
function evaluateEssayScore(essayText, criteriaText, maxPoints) {
    if (!essayText || essayText.trim().length === 0) return 0;

    let text = essayText.trim();
    let wordCount = text.split(/\s+/).length;
    let totalMax = maxPoints || 10;

    let scorePercentage = 0;

    // 1. Length & Depth Check (35%)
    if (wordCount >= 30) scorePercentage += 0.35;
    else if (wordCount >= 15) scorePercentage += 0.25;
    else scorePercentage += 0.15;

    // 2. Keyword & Concept Relevance (40%)
    let lowerCriteria = (criteriaText || "").toLowerCase();
    let lowerEssay = text.toLowerCase();
    let keywords = lowerCriteria.match(/\b[a-zà-ÿ]{4,}\b/gi) || [];
    
    let matchedCount = 0;
    keywords.forEach(kw => {
        if (lowerEssay.includes(kw)) matchedCount++;
    });

    if (keywords.length > 0) {
        let matchRatio = matchedCount / keywords.length;
        scorePercentage += Math.min(matchRatio * 0.40, 0.40);
    } else {
        scorePercentage += 0.35;
    }

    // 3. Coherence & Structure (25%)
    if (text.includes('.') || text.includes(',')) scorePercentage += 0.25;
    else scorePercentage += 0.15;

    let computedPoints = Math.round(scorePercentage * totalMax);
    return Math.min(Math.max(computedPoints, 1), totalMax);
}

io.on('connection', (socket) => {
    socket.emit('titleUpdated', currentAppTitle);
    socket.emit('quizModeUpdated', currentQuizMode);
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
    socket.emit('applyCustomQuestionsList', customQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);

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
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
            io.emit('photoArchiveUpdated', serverPhotoArchive);
            io.emit('newAttorneyJoined', { groupName, photo });
        }
    });

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

            const allFinished = Object.keys(groupTimers).every(g => groupTimers[g] <= 0 || groupCompletedStatus[g]);
            if (activeCount === 0 || allFinished) {
                clearInterval(timerInterval);
                io.emit('timeUp');
            }
        }, 1000);
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        Object.keys(groupTimers).forEach(g => {
            groupTimers[g] = 0;
        });
        io.emit('timerUpdate', groupTimers);
        io.emit('timeUp');
    });

    socket.on('setTimerDuration', (seconds) => {
        Object.keys(groupTimers).forEach(g => {
            groupTimers[g] = seconds;
        });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('submitAnswer', ({ groupName, questionIndex, answer, answeredCount }) => {
        if (groupScores[groupName] !== undefined && !groupCompletedStatus[groupName]) {
            let qObj = customQuestionsList[questionIndex];
            let earnedPoints = 0;
            let isCorrect = false;

            if (qObj) {
                if (qObj.type === 'essay') {
                    earnedPoints = evaluateEssayScore(answer, qObj.rubrics || qObj.explanation, qObj.points || 10);
                    isCorrect = earnedPoints > 0;
                } else {
                    let cleanUserAns = String(answer).trim().toLowerCase();
                    let cleanCorrectAns = String(qObj.answer).trim().toLowerCase();
                    if (cleanUserAns === cleanCorrectAns) {
                        isCorrect = true;
                        earnedPoints = qObj.points || 1;
                        if (groupTimers[groupName] !== undefined) {
                            groupTimers[groupName] += 5;
                        }
                    } else {
                        earnedPoints = 0;
                    }
                }
            }

            socket.emit('answerFeedback', { isCorrect, questionId: `q${questionIndex + 1}`, answer, earnedPoints, maxPoints: qObj ? (qObj.points || 1) : 1 });

            groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
            
            if (answeredCount >= customQuestionsList.length) {
                groupCompletedStatus[groupName] = true;
            }

            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
            io.emit('timerUpdate', groupTimers);

            const allCompleted = Object.keys(groupCompletedStatus).every(g => groupCompletedStatus[g]);
            if (allCompleted) {
                if (timerInterval) clearInterval(timerInterval);
                io.emit('timeUp');
            }
        }
    });

    socket.on('resetGame', () => {
        if (timerInterval) clearInterval(timerInterval);
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
        io.emit('resetState');
    });

    socket.on('clearPhotoArchive', () => {
        serverPhotoArchive = [];
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});