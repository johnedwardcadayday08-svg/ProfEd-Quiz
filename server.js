const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let isGameStarted = false;
let timerInterval = null;
let groupScores = {
    'Attorney 1': 0,
    'Attorney 2': 0,
    'Attorney 3': 0,
    'Attorney 4': 0
};

// Hiwalay na timer para sa bawat grupo sa server side
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

let popupQueue = [];

const correctAnswers = {
    q1: 'RA7277',
    q2: 'RA7610',
    q3: 'RA8371',
    q4: 'CONST',
    q5: 'RA7277',
    q6: 'RA7836'
};

io.on('connection', (socket) => {
    // Ipadala ang kasalukuyang estado pag-connect
    socket.emit('gameState', { isGameStarted });
    socket.emit('updateState', { groupScores, photos: attorneyPhotos });

    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (groupName && photo) {
            attorneyPhotos[groupName] = photo;
            popupQueue.push({ groupName, photo });
            io.emit('updateState', { groupScores, photos: attorneyPhotos });
            io.emit('showJudgePopupQueue', popupQueue);
        }
    });

    socket.on('startTimer', () => {
        if (!isGameStarted) {
            isGameStarted = true;
            // I-reset sa 60 seconds bago magsimula
            groupTimers = {
                'Attorney 1': 60,
                'Attorney 2': 60,
                'Attorney 3': 60,
                'Attorney 4': 60
            };
            
            io.emit('gameState', { isGameStarted });

            if (timerInterval) clearInterval(timerInterval);

            timerInterval = setInterval(() => {
                let allZero = true;
                
                // Bawasan ang timer ng bawat grupo nang INDEPENDENT
                Object.keys(groupTimers).forEach(group => {
                    if (groupTimers[group] > 0) {
                        groupTimers[group] -= 1;
                        allZero = false;
                    }
                });

                // I-broadcast ang bawat group timer sa lahat ng clients
                io.emit('timerUpdate', groupTimers);

                if (allZero) {
                    clearInterval(timerInterval);
                    isGameStarted = false;
                    io.emit('timeUp');
                }
            }, 1000);
        }
    });

    socket.on('submitAnswer', ({ groupName, questionId, answer }) => {
        if (!isGameStarted) return;
        
        const correctAns = correctAnswers[questionId];
        const isCorrect = (answer === correctAns);

        if (isCorrect) {
            groupScores[groupName] = (groupScores[groupName] || 0) + 1;
            
            // MAGDAGDAG NG +5 SECONDS SA SERVER TIMER NG TUMAMANG GRUPO LAMANG
            if (groupTimers[groupName] !== undefined) {
                groupTimers[groupName] += 5;
            } else {
                groupTimers[groupName] = 65;
            }
        }

        // I-send ang feedback sa nag-submit
        socket.emit('answerFeedback', { isCorrect, questionId, answer });

        // I-update ang scores at timers sa lahat
        io.emit('updateState', { groupScores, photos: attorneyPhotos });
        io.emit('timerUpdate', groupTimers);
    });

    socket.on('resetGame', () => {
        if (timerInterval) clearInterval(timerInterval);
        isGameStarted = false;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        groupTimers = { 'Attorney 1': 60, 'Attorney 2': 60, 'Attorney 3': 60, 'Attorney 4': 60 };
        popupQueue = [];
        io.emit('resetState');
    });

    socket.on('disconnect', () => {
        // Disconnect handler
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});