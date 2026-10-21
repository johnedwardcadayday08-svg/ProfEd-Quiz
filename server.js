const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let isGameStarted = false;
let timerInterval = null;
let groupScores = {
    'Attorney 1': 0,
    'Attorney 2': 0,
    'Attorney 3': 0,
    'Attorney 4': 0
};

let groupTimers = {
    'Attorney 1': 60,
    'Attorney 2': 60,
    'Attorney 3': 60,
    'Attorney 4': 60
};

let attorneyPhotos = {
    'Attorney 1': '',
    'Attorney 2': '',
    'Attorney 3': '',
    'Attorney 4': ''
};

let groupCompletedStatus = {
    'Attorney 1': false,
    'Attorney 2': false,
    'Attorney 3': false,
    'Attorney 4': false
};

let popupQueue = [];

let correctAnswers = {
    q1: 'RA7277',
    q2: 'RA7610',
    q3: 'RA8371',
    q4: 'CONST',
    q5: 'RA7277',
    q6: 'RA7836'
};

io.on('connection', (socket) => {
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
    socket.emit('timerUpdate', groupTimers);

    // Dynamic update para sa realtime inserted questions at answer key
    socket.on('updateCustomQuestions', ({ questionsData, answersData }) => {
        if (answersData) {
            correctAnswers = answersData;
        }
        io.emit('applyCustomQuestions', questionsData);
    });

    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (groupName && photo) {
            attorneyPhotos[groupName] = photo;
            popupQueue.push({ groupName, photo });
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
            io.emit('showJudgePopupQueue', popupQueue);
        }
    });

    socket.on('startTimer', () => {
        if (!isGameStarted) {
            isGameStarted = true;
            groupTimers = {
                'Attorney 1': 60,
                'Attorney 2': 60,
                'Attorney 3': 60,
                'Attorney 4': 60
            };
            
            groupCompletedStatus = {
                'Attorney 1': false,
                'Attorney 2': false,
                'Attorney 3': false,
                'Attorney 4': false
            };
            
            io.emit('gameState', { isGameStarted });
            io.emit('timerUpdate', groupTimers);
            io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });

            if (timerInterval) clearInterval(timerInterval);

            timerInterval = setInterval(() => {
                let allZero = true;
                
                Object.keys(groupTimers).forEach(group => {
                    if (groupTimers[group] > 0) {
                        groupTimers[group] -= 1;
                        allZero = false;
                    }
                });

                io.emit('timerUpdate', groupTimers);

                if (allZero) {
                    clearInterval(timerInterval);
                    isGameStarted = false;
                    io.emit('timeUp');
                }
            }, 1000);
        }
    });

    socket.on('forceTimeUp', () => {
        if (timerInterval) clearInterval(timerInterval);
        isGameStarted = false;
        io.emit('timeUp');
    });

    socket.on('submitAnswer', ({ groupName, questionId, answer, answeredCount }) => {
        if (!isGameStarted) return;
        
        const correctAns = correctAnswers[questionId];
        const isCorrect = (answer === correctAns);

        if (isCorrect) {
            groupScores[groupName] = (groupScores[groupName] || 0) + 1;
            
            if (groupTimers[groupName] !== undefined) {
                groupTimers[groupName] += 5;
            } else {
                groupTimers[groupName] = 65;
            }
        }

        if (answeredCount >= 6) {
            groupCompletedStatus[groupName] = true;
            io.emit('groupFinished', { groupName });
        }

        socket.emit('answerFeedback', { isCorrect, questionId, answer });
        io.emit('updateState', { groupScores, photos: attorneyPhotos, completedStatus: groupCompletedStatus });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('resetGame', () => {
        if (timerInterval) clearInterval(timerInterval);
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        groupTimers = { 'Attorney 1': 60, 'Attorney 2': 60, 'Attorney 3': 60, 'Attorney 4': 60 };
        groupCompletedStatus = { 'Attorney 1': false, 'Attorney 2': false, 'Attorney 3': false, 'Attorney 4': false };
        
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
        popupQueue = [];

        io.emit('resetState');
        io.emit('gameState', { isGameStarted });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});