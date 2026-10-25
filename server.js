// ==========================================
// MATALINONG PAG-SCORING AT TEXT NORMALIZATION
// ==========================================

function normalizeText(str) {
    if (!str) return "";
    return str
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^\w\s]/gi, '') // Tinatanggal ang mga kuwit, tuldok, at simbolo
        .replace(/\s+/g, ' ');   // Ginagawang iisang space ang paulit-ulit na space
}

function isAnswerCorrect(userAns, correctAns) {
    const cleanUser = normalizeText(userAns);
    const cleanCorrect = normalizeText(correctAns);

    if (!cleanUser) return false;

    // 1. Exact match pagkatapos linisin ang spaces at capitalization
    if (cleanUser === cleanCorrect) return true;

    // 2. Kung ang tamang sagot ay nakapaloob sa isinagot (o baligtad)
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
// SOCKET.IO 'submitAnswer' EVENT HANDLER
// ==========================================

io.on('connection', (socket) => {
    // ... (Ilagay ito sa loob ng iyong existing connection listener kung saan naroon ang iba pang socket events)

    socket.on('submitAnswer', ({ groupName, questionIndex, answer }) => {
        // Sinisigurong umiiral ang global list ng mga tanong at scores
        if (typeof questionsList === 'undefined' || !questionsList[questionIndex]) return;
        
        const currentQ = questionsList[questionIndex];
        let isCorrect = false;
        let earnedPoints = 0;

        const qType = (currentQ.type || 'multiple-choice').toLowerCase();

        if (qType === 'multiple-choice' || qType === 'true-false') {
            // Direct letter or option comparison gamit ang normalizeText para iwas bug sa spaces/caps
            isCorrect = normalizeText(answer) === normalizeText(currentQ.answer);
            earnedPoints = isCorrect ? (currentQ.points || 1) : 0;
        } else {
            // Identification, Enumeration, Essay, at Mixed Text gamit ang flexible matching
            isCorrect = isAnswerCorrect(answer, currentQ.answer);
            earnedPoints = isCorrect ? (currentQ.points || 1) : 0;
        }

        // I-update ang Score at magdagdag ng Bonus Time kung Tama
        if (typeof groupScores !== 'undefined') {
            groupScores[groupName] = (groupScores[groupName] || 0) + earnedPoints;
            if (typeof groupTimers !== 'undefined' && groupTimers[groupName] !== undefined) {
                groupTimers[groupName] += 5; // +5 Seconds Bonus Time!
            }
        }

        // Magpadala ng feedback pabalik sa partikular na participant
        socket.emit('answerFeedback', {
            isCorrect: isCorrect,
            earnedPoints: earnedPoints
        });

        // I-broadcast ang na-update na estado sa lahat ng nakakonektang screen at monitor
        io.emit('updateState', {
            groupScores: typeof groupScores !== 'undefined' ? groupScores : {},
            photos: typeof attorneyPhotos !== 'undefined' ? attorneyPhotos : {},
            completedStatus: typeof groupCompletedStatus !== 'undefined' ? groupCompletedStatus : {}
        });
    });
});