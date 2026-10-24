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

// ==========================================
// HELPER 1: Pang-linis ng Text (Case-insensitive & Space Tolerance)
// ==========================================
function normalizeText(text) {
    if (!text) return "";
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')       // Ginagawang iisang space ang maramihang spaces
        .replace(/[^\w\s]/gi, ''); // Tinatanggal ang mga espesyal na karakter/bantas
}

// ==========================================
// HELPER 2: Smart Answer & Essay Checker
// ==========================================
function checkSmartAnswer(userAnswer, correctAnswerKey, questionType, maxPoints = 1) {
    const normUser = normalizeText(userAnswer);
    const normCorrect = normalizeText(correctAnswerKey);

    if (!normUser) return { isCorrect: false, earnedPoints: 0 };

    // A. Kapag HINDI Essay (Multiple Choice, True/False, Identification, Enumeration)
    if (questionType !== 'essay') {
        // Tamang-tama ang salita (kahit iba ang capital/small letters o spaces)
        if (normUser === normCorrect) {
            return { isCorrect: true, earnedPoints: maxPoints };
        }
        // Kung napasama ang tamang keyword
        if (normCorrect.length > 2 && normUser.includes(normCorrect)) {
            return { isCorrect: true, earnedPoints: maxPoints };
        }
        return { isCorrect: false, earnedPoints: 0 };
    }

    // B. Kapag ESSAY (Smart Consideration batay sa Keywords/Content)
    const keywords = normCorrect.split(' ').filter(word => word.length > 3);
    
    // Kapag walang piho na key answer, basta may nai-type na essay (10+ characters)
    if (keywords.length === 0) {
        return normUser.length >= 10 
            ? { isCorrect: true, earnedPoints: maxPoints } 
            : { isCorrect: false, earnedPoints: Math.ceil(maxPoints * 0.5) };
    }

    let matchedCount = 0;
    keywords.forEach(kw => {
        if (normUser.includes(kw)) {
            matchedCount++;
        }
    });

    const matchRatio = matchedCount / keywords.length;

    if (matchRatio >= 0.5) {
        // High Consideration: Perfect score
        return { isCorrect: true, earnedPoints: maxPoints };
    } else if (matchRatio >= 0.2 || normUser.length >= 15) {
        // Consideration / Partial Points
        const partial = Math.max(1, Math.ceil(maxPoints * 0.7));
        return { isCorrect: true, earnedPoints: partial };
    } else {
        // Effort points para sa nag-essay
        const effortPts = Math.max(1, Math.floor(maxPoints * 0.3));
        return { isCorrect: false, earnedPoints: effortPts };
    }
}

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
    socket.emit('applyCustomQuestionsList', globalQuestionsList);
    socket.emit('timerUpdate', groupTimers);
    socket.emit('photoArchiveUpdated', serverPhotoArchive);
    socket.emit('groupHistoryUpdated', groupScoreHistoryArchive);
    socket.emit('individualHistoryUpdated', individualScoreHistoryArchive);
    socket.emit('individualParticipantsUpdated', individualParticipants);
    socket.emit('individualScoresUpdated', individualScores);

    // 1. SET GAME MODE HANDLER
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

        io.emit('gameModeUpdated', currentMode);
        io.emit('resetState');
        io.emit('applyCustomQuestionsList', globalQuestionsList);
        io.emit('gameState', { isGameStarted: false });
        io.emit('timerUpdate', groupTimers);
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus, mode: currentMode });
        io.emit('individualParticipantsUpdated', individualParticipants);
        io.emit('individualScoresUpdated', individualScores);
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

    // === SUBMIT INDIVIDUAL ANSWER ===
    socket.on('submitIndividualAnswer', ({ fullName, questionIndex, answer }, callback) => {
        const question = globalQuestionsList[questionIndex];
        if (!question) return;

        const result = checkSmartAnswer(answer, question.answer, question.type, question.points || 1);

        if (result.isCorrect || result.earnedPoints > 0) {
            individualScores[fullName] = (individualScores[fullName] || 0) + result.earnedPoints;
        }

        const responseData = {
            isCorrect: result.isCorrect,
            earnedPoints: result.earnedPoints,
            maxPoints: question.points || 1,
            qType: question.type
        };

        if (typeof callback === 'function') callback(responseData);

        io.emit('individualScoresUpdated', individualScores);
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
            globalQuestionsList = questionsList;
            io.emit('applyCustomQuestionsList', globalQuestionsList);
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

 // === REAL-TIME START QUIZ & TIMER ===
    socket.on('startQuiz', () => {
        isGameStarted = true;
        io.emit('quizStarted');
        io.emit('gameState', { isGameStarted: true });
    });

    socket.on('startTimer', () => {
        isGameStarted = true;
        io.emit('quizStarted');
        io.emit('gameState', { isGameStarted: true });
        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            let activeCount = 0;
            Object.keys(groupTimers).forEach(g => {
                if (!groupCompletedStatus[g] && groupTimers[g] > 0) {
                    groupTimers[g]--;
                    activeCount++;
                }
            });
            // Real-time broadcast ng timer sa LAHAT ng devices
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

    // === SUBMIT GROUP ANSWER ===
   socket.on('submitAnswer', ({ groupName, questionIndex, answer }) => {
        const question = globalQuestionsList[questionIndex];
        if (!question) return;

        const result = checkSmartAnswer(answer, question.answer, question.type, question.points || 1);

        if (result.isCorrect || result.earnedPoints > 0) {
            groupScores[groupName] = (groupScores[groupName] || 0) + result.earnedPoints;
        }

        // I-send pabalik ang feedback sa sumagot na participant
        socket.emit('answerFeedback', {
            isCorrect: result.isCorrect,
            earnedPoints: result.earnedPoints,
            maxPoints: question.points || 1,
            questionId: `q${questionIndex + 1}`,
            answer: answer,
            qType: question.type
        });

        // I-broadcast sa lahat (lalo na sa Judge monitor) ang bagong iskor
        io.emit('updateState', { 
            groupScores, 
            photos: attorneyPhotos, 
            completedStatus: groupCompletedStatus, 
            mode: currentMode 
        });
    });

    // === RESET GAME (Preserving Questions in Realtime) ===
    socket.on('resetGame', () => {
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        individualScores = {};
        isGameStarted = false;

        io.emit('resetState');
        io.emit('applyCustomQuestionsList', globalQuestionsList); // Siguraduhing naibabalik ang mga tanong
        io.emit('gameState', { isGameStarted: false });
        io.emit('timerUpdate', groupTimers);
        io.emit('updateState', {
            groupScores,
            photos: attorneyPhotos,
            completedStatus: groupCompletedStatus,
            mode: currentMode
        });
        io.emit('individualParticipantsUpdated', individualParticipants);
        io.emit('individualScoresUpdated', individualScores);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});