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

// MATALINONG SCORING ENGINE PARA SA ESSAY
function evaluateSmartEssayScore(essayText, questionText, criteriaText, maxPoints) {
    if (!essayText || typeof essayText !== 'string') return 0;

    let text = essayText.trim().toLowerCase();
    if (text.length < 10) return 0; // Sobrang iksi o walang laman

    let maxScore = maxPoints || 10;
    let combinedContext = ((questionText || "") + " " + (criteriaText || "")).toLowerCase();

    // Kunin ang mahahalagang mga salita (stop-word removal)
    let words = combinedContext.match(/\b[a-zà-ÿ0-9]{4,}\b/gi) || [];
    let stopWords = new Set(['e.g.', 'type', 'points', 'para', 'sa', 'mga', 'nang', 'maging', 'dahil', 'ayon', 'kundi', 'rubrics', 'criteria']);
    let coreKeywords = Array.from(new Set(words.filter(w => !stopWords.has(w))));

    // 1. Tiyakin kung may kaugnayan ang sagot sa Tanong at Criteria
    let matchCount = 0;
    coreKeywords.forEach(kw => {
        if (text.includes(kw)) matchCount++;
    });

    let relevanceRatio = coreKeywords.length > 0 ? (matchCount / coreKeywords.length) : 0.5;

    // Kapag walang kaugnayan sa tanong o criteria, 0 puntos!
    if (coreKeywords.length >= 3 && matchCount === 0) {
        return 0;
    }

    // 2. Pagtuon sa Haba at Lalim ng Paliwanag
    let wordCount = text.split(/\s+/).length;
    let lengthScoreRatio = 0;
    if (wordCount >= 30) lengthScoreRatio = 1.0;
    else if (wordCount >= 15) lengthScoreRatio = 0.7;
    else if (wordCount >= 8) lengthScoreRatio = 0.4;
    else lengthScoreRatio = 0.2;

    // Pagkukuwenta ng kabuuang porsyento ng puntos
    let finalRatio = (relevanceRatio * 0.6) + (lengthScoreRatio * 0.4);

    if (finalRatio < 0.25) return 0; // Pag hindi na-meet ang pamantayan

    let computedPoints = Math.round(finalRatio * maxScore);
    return Math.min(Math.max(computedPoints, 0), maxScore);
}

io.on('connection', (socket) => {
// --- BAGONG FEATURE: INDIVIDUAL PARTICIPANTS AT SCORE HISTORY ---
let individualParticipants = {}; // { socketId: { fullName, groupName, photo, score } }
let individualScores = {};       // { fullName: score }
let individualHistoryArchive = []; // [{ fullName, score, date, time }]
let groupHistoryArchive = [];     // [{ groupName, score, date, time }]

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
        
        // I-broadcast ang updated individual participants at scores
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
    }

    io.emit('individualParticipantsUpdated', individualParticipants);
    io.emit('individualScoresUpdated', individualScores);

    if (typeof callback === 'function') {
        callback({ isCorrect, earnedPoints, maxPoints: qObj ? (qObj.points || 1) : 1 });
    }
});

socket.on('deleteArchivePhoto', (index) => {
    if (serverPhotoArchive && serverPhotoArchive[index] !== undefined) {
        serverPhotoArchive.splice(index, 1);
        io.emit('photoArchiveUpdated', serverPhotoArchive);
    }
});
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
                    earnedPoints = evaluateSmartEssayScore(answer, qObj.question, qObj.rubrics || qObj.explanation, qObj.points || 10);
                    isCorrect = earnedPoints > 0;
                } else {
                    let cleanUserAns = String(answer).trim().toLowerCase();
                    let cleanCorrectAns = String(qObj.answer).trim().toLowerCase();
                    
                    if (cleanUserAns === cleanCorrectAns || (cleanCorrectAns !== 'n/a' && cleanUserAns.includes(cleanCorrectAns))) {
                        isCorrect = true;
                        earnedPoints = qObj.points || 1;
                        if (groupTimers[groupName] !== undefined) {
                            groupTimers[groupName] += 5; // Bonus time sa tamang sagot
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
// Clear participant photos and rankings from the monitor only
attorneyPhotos = {
    'Attorney 1': '',
    'Attorney 2': '',
    'Attorney 3': '',
    'Attorney 4': ''
};

individualParticipants = {};
individualScores = {};
individualAnsweredQuestions = {};

io.emit('updateState', {
    groupScores,
    photos: attorneyPhotos,
    completedStatus: groupCompletedStatus
});

io.emit('individualParticipantsUpdated', []);
io.emit('individualScoresUpdated', {});
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