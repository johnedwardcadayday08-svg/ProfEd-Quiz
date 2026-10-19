const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

let groupScores = {
    'Attorney 1': 0,
    'Attorney 2': 0,
    'Attorney 3': 0,
    'Attorney 4': 0
};

let attorneyPhotos = {
    'Attorney 1': '',
    'Attorney 2': '',
    'Attorney 3': '',
    'Attorney 4': ''
};

let judgePopupQueue = [];
let isQueueRunning = false;

// NAKA-SET NA SA 1 MINUTO (60 SECONDS) ANG TIMER
let timer = 60;
let timerInterval = null;
let timerRunning = false;

io.on('connection', (socket) => {
    socket.emit('updateState', { groupScores, photos: attorneyPhotos, timer, timerRunning });
    socket.emit('timerUpdate', timer);

    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (groupName && photo) {
            attorneyPhotos[groupName] = photo;
            judgePopupQueue.push({ groupName, photo });
            
            io.emit('updateState', { groupScores, photos: attorneyPhotos, timer, timerRunning });

            if (!isQueueRunning) {
                processPopupQueue();
            }
        }
    });

    function processPopupQueue() {
        if (judgePopupQueue.length === 0) {
            isQueueRunning = false;
            return;
        }
        isQueueRunning = true;
        
        const currentBatch = [...judgePopupQueue];
        judgePopupQueue = [];

        io.emit('showJudgePopupQueue', currentBatch);

        const totalDuration = currentBatch.length * 3400;
        setTimeout(() => {
            processPopupQueue();
        }, totalDuration);
    }

    socket.on('startTimer', () => {
        if (!timerRunning) {
            timerRunning = true;
            if (timerInterval) clearInterval(timerInterval);
            
            timerInterval = setInterval(() => {
                if (timer > 0) {
                    timer--;
                    io.emit('timerUpdate', timer);
                } else {
                    clearInterval(timerInterval);
                    timerRunning = false;
                    io.emit('timeUp');
                }
            }, 1000);
        }
    });

    socket.on('resetGame', () => {
        clearInterval(timerInterval);
        timerRunning = false;
        timer = 60;
        Object.keys(groupScores).forEach(group => {
            groupScores[group] = 0;
            attorneyPhotos[group] = '';
        });
        judgePopupQueue = [];
        isQueueRunning = false;
        io.emit('resetState');
        io.emit('timerUpdate', timer);
    });

    socket.on('submitAnswer', ({ groupName, questionId, answer }) => {
        let correctAnswers = {
            q1: 'RA7277',
            q2: 'RA7610',
            q3: 'RA8371',
            q4: 'CONST',
            q5: 'RA7277',
            q6: 'RA7836'
        };
        let isCorrect = (correctAnswers[questionId] === answer);
        if (isCorrect && groupScores[groupName] !== undefined) {
            groupScores[groupName]++;
        }
        socket.emit('answerFeedback', { questionId, isCorrect, answer });
        io.emit('updateState', { groupScores, photos: attorneyPhotos, timer, timerRunning });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});