const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); 

let timer = 60;
let timerInterval = null;
let isGameStarted = false; 

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

io.on('connection', (socket) => {
    socket.emit('updateState', { groupScores, photos: attorneyPhotos });
    socket.emit('gameState', { isGameStarted });

    socket.on('registerAttorneyPhoto', ({ groupName, photo }) => {
        if (attorneyPhotos[groupName] !== undefined) {
            attorneyPhotos[groupName] = photo;
            judgePopupQueue.push({ groupName, photo });
            io.emit('updateState', { groupScores, photos: attorneyPhotos });
            io.emit('showJudgePopupQueue', judgePopupQueue);
        }
    });

    socket.on('startTimer', () => {
        if (!isGameStarted) {
            isGameStarted = true;
            io.emit('gameState', { isGameStarted: true });
            
            timer = 60;
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                timer--;
                io.emit('timerUpdate', timer);
                if (timer <= 0) {
                    clearInterval(timerInterval);
                    io.emit('timeUp');
                }
            }, 1000);
        }
    });

    socket.on('submitAnswer', ({ groupName, questionId, answer }) => {
        if (!isGameStarted) return;

        const correctAnswers = {
            q1: 'RA7277',
            q2: 'RA7610',
            q3: 'RA8371',
            q4: 'CONST',
            q5: 'RA7277',
            q6: 'RA7836'
        };

        let isCorrect = (correctAnswers[questionId] === answer);
        if (isCorrect) {
            groupScores[groupName] = (groupScores[groupName] || 0) + 1;
            io.emit('updateState', { groupScores, photos: attorneyPhotos });
        }
        socket.emit('answerFeedback', { isCorrect, questionId, answer });
    });

    socket.on('resetGame', () => {
        isGameStarted = false;
        clearInterval(timerInterval);
        timer = 60;
        groupScores = { 'Attorney 1': 0, 'Attorney 2': 0, 'Attorney 3': 0, 'Attorney 4': 0 };
        attorneyPhotos = { 'Attorney 1': '', 'Attorney 2': '', 'Attorney 3': '', 'Attorney 4': '' };
        judgePopupQueue = [];
        io.emit('resetState');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});