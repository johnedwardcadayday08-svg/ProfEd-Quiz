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
let currentMode = "group";
let isGameStarted = false;
let groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
let groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
let attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
let groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
let timerInterval = null;
let serverPhotoArchive = [];

let groupScoreHistoryArchive = [];
let individualScoreHistoryArchive = [];
let individualParticipants = {}; 
let individualScores = {};       

let individualCompletedStatus = {}; 
let groupAnswerTracker = {};
let individualAnswerTracker = {};

let globalQuestionsList = [
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

function normalizeText(text) {
    if (!text) return "";
    return text.toString().toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/gi, ''); 
}


    // MAS MATALINO AT MAHIGPIT NA ESSAY GRADING
function checkSmartAnswer(userAnswer, correctAnswerKey, questionType, maxPoints = 1) {
    const normUser = normalizeText(userAnswer);
    const normCorrect = normalizeText(correctAnswerKey);

    if (!normUser || normUser.length < 3) return { isCorrect: false, earnedPoints: 0 };

    // True/False Handling
    const isTfKeywords = (val) => ['true', 'false', 't', 'f', 'tama', 'mali', 'yes', 'no'].includes(val);
    if (questionType === 'true-false' || (isTfKeywords(normUser) && isTfKeywords(normCorrect))) {
        let userBool = ['true', 't', 'tama', 'yes'].includes(normUser);
        let correctBool = ['true', 't', 'tama', 'yes'].includes(normCorrect);
        
        if (userBool === correctBool) {
            return { isCorrect: true, earnedPoints: maxPoints };
        }
        return { isCorrect: false, earnedPoints: 0 };
    }

    // Multiple Choice & Identification
    if (questionType !== 'essay') {
        if (normUser === normCorrect || normUser.includes(normCorrect) || normCorrect.includes(normUser)) {
            return { isCorrect: true, earnedPoints: maxPoints };
        }
        return { isCorrect: false, earnedPoints: 0 };
    }

    // --- MAHIGPIT NA ESSAY EVALUATION ---
    const userLength = normUser.length;
    const keywords = normCorrect.split(' ').filter(word => word.length > 3);
    
    let matchedCount = 0;
    if (keywords.length > 0) {
        keywords.forEach(kw => { if (normUser.includes(kw)) matchedCount++; });
    }
    const matchRatio = keywords.length > 0 ? (matchedCount / keywords.length) : 0;

    let earnedPoints = 0;

    // Kung napakaikli, walang kinalaman, o puro sabog ang sagot -> 0 puntos
    if (userLength < 15 || (keywords.length > 0 && matchRatio === 0 && userLength < 50)) {
        return { isCorrect: false, earnedPoints: 0 };
    }

    // Kailangan pasok sa keywords o sapat ang haba ng may katuturan
    if (matchRatio >= 0.5 || (keywords.length === 0 && userLength >= 80)) {
        earnedPoints = maxPoints; // Perpektong puntos
    } else if (matchRatio >= 0.3 || userLength >= 50) {
        earnedPoints = Math.max(1, Math.round(maxPoints * 0.6)); // Katamtamang puntos
    } else {
        earnedPoints = Math.max(1, Math.round(maxPoints * 0.3)); // Mababang puntos kung malayo sa criteria
    }

    return {
        isCorrect: earnedPoints > 0,
        earnedPoints: earnedPoints
    };
}

    let matchedCount = 0;
    keywords.forEach(kw => { if (normUser.includes(kw)) matchedCount++; });
    const matchRatio = matchedCount / keywords.length;

    if (matchRatio >= 0.3 || normUser.length >= 25) {
        return { isCorrect: true, earnedPoints: Math.max(1, Math.round(maxPoints * 0.8)) };
    }
    return { isCorrect: false, earnedPoints: 0 };
}

io.on('connection', (socket) => {
    socket.emit('titleUpdated', currentAppTitle);
    socket.emit('quizModeUpdated', currentQuizMode);
    socket.emit('gameModeUpdated', currentMode);
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
    socket.emit('applyCustomQuestionsList', globalQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('groupHistoryUpdated', groupScoreHistoryArchive);
    socket.emit('individualHistoryUpdated', individualScoreHistoryArchive);
    socket.emit('individualParticipantsUpdated', individualParticipants);
    socket.emit('individualScoresUpdated', { scores: individualScores, completedStatus: individualCompletedStatus });

    socket.on('setGameMode', (mode) => {
        currentMode = mode;
        isGameStarted = false;
        if (timerInterval) clearInterval(timerInterval);

        Object.keys(groupTimers).forEach(g => { groupTimers[g] = 300; });
        Object.keys(groupScores).forEach(g => {
            groupScores[g] = 0;
            attorneyPhotos[g] = '';
            groupCompletedStatus[g] = false;
        });

        individualParticipants = {};
        individualScores = {};
        individualCompletedStatus = {};
        groupAnswerTracker = {};
        individualAnswerTracker = {};

        io.emit('gameModeUpdated', currentMode);
        io.emit('resetState');
        io.emit('applyCustomQuestionsList', globalQuestionsList);
        io.emit('gameState', { isGameStarted: false });
        io.emit('timerUpdate', groupTimers);
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
        io.emit('individualParticipantsUpdated', individualParticipants);
        io.emit('individualScoresUpdated', { scores: individualScores, completedStatus: individualCompletedStatus });
    });

    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (groupName && photo) {
            attorneyPhotos[groupName] = photo;
            serverPhotoArchive.push({ groupName, photo, timestamp: new Date().toLocaleTimeString() });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
            io.emit('newAttorneyJoined', { groupName, photo });
        }
    });

    socket.on('registerIndividualParticipant', ({ fullName, photo }) => {
        if (fullName) {
            const cleanName = fullName.trim();
            individualParticipants[socket.id] = {
                fullName: cleanName,
                photo: photo || '',
                score: 0,
                timestamp: new Date().toLocaleTimeString(),
                date: new Date().toLocaleDateString()
            };
            if (individualScores[cleanName] === undefined) {
                individualScores[cleanName] = 0;
            }
            io.emit('individualParticipantsUpdated', individualParticipants);
            io.emit('individualScoresUpdated', { scores: individualScores, completedStatus: individualCompletedStatus });
        }
    });

    // UNIFIED SUBMIT ANSWER PARA SA GROUP AT INDIVIDUAL
    socket.on('submitAnswer', ({ groupName, questionIndex, answer }) => {
        const question = globalQuestionsList[questionIndex];
        if (!question) return;

        const result = checkSmartAnswer(answer, question.answer, question.type, question.points || 1);

        if (currentMode === 'group') {
            if (result.isCorrect || result.earnedPoints > 0) {
                groupScores[groupName] = (groupScores[groupName] || 0) + result.earnedPoints;
                if (groupTimers[groupName] !== undefined && groupTimers[groupName] > 0) {
                    groupTimers[groupName] += 5;
                }
            }

            if (!groupAnswerTracker[groupName]) groupAnswerTracker[groupName] = new Set();
            groupAnswerTracker[groupName].add(questionIndex);

            if (groupAnswerTracker[groupName].size >= globalQuestionsList.length) {
                groupCompletedStatus[groupName] = true;
                io.emit('groupFinished', { groupName });
            }

            io.emit('timerUpdate', groupTimers);
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
        } else {
            // INDIVIDUAL MODE
            if (result.isCorrect || result.earnedPoints > 0) {
                individualScores[groupName] = (individualScores[groupName] || 0) + result.earnedPoints;
            }

            if (!individualAnswerTracker[groupName]) individualAnswerTracker[groupName] = new Set();
            individualAnswerTracker[groupName].add(questionIndex);

            if (individualAnswerTracker[groupName].size >= globalQuestionsList.length) {
                individualCompletedStatus[groupName] = true;
                io.emit('individualFinished', { fullName: groupName });
            }

            io.emit('individualScoresUpdated', { scores: individualScores, completedStatus: individualCompletedStatus });
        }

        socket.emit('answerFeedback', {
            isCorrect: result.isCorrect,
            earnedPoints: result.earnedPoints,
            maxPoints: question.points || 1,
            questionId: `q${questionIndex + 1}`,
            answer: answer,
            qType: question.type
        });
    });

    socket.on('resetGame', () => {
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        groupTimers = { 'Attorney 1': 300, 'Attorney 2': 300, 'Attorney 3': 300, 'Attorney 4': 300 };
        individualScores = {};
        individualCompletedStatus = {};
        groupAnswerTracker = {};
        individualAnswerTracker = {};
        isGameStarted = false;

        if (timerInterval) clearInterval(timerInterval);

        io.emit('resetState');
        io.emit('applyCustomQuestionsList', globalQuestionsList);
        io.emit('gameState', { isGameStarted: false });
        io.emit('timerUpdate', groupTimers);
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
        io.emit('individualScoresUpdated', { scores: individualScores, completedStatus: individualCompletedStatus });
    });

    socket.on('startQuiz', () => {
        isGameStarted = true;
        io.emit('quizStartedSignal');
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
        
        // I-broadcast ang tamang results modal depende sa mode
        if (currentMode === 'individual') {
            io.emit('triggerIndividualResults', { individualScores, individualParticipants, totalMaxScore });
        } else {
            io.emit('timeUp');
        }
    });

    socket.on('setTimerDuration', (seconds) => {
        Object.keys(groupTimers).forEach(g => { groupTimers[g] = seconds; });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('updatePlainQuestionsData', (questionsList) => {
        if (questionsList && questionsList.length > 0) {
            globalQuestionsList = questionsList;
            io.emit('applyCustomQuestionsList', globalQuestionsList);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});