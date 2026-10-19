const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Binago natin ito para basahin ang kasalukuyang folder nang direkta
app.use(express.static(__dirname));

let timer = 30; // 30 seconds o depende sa gusto mong oras
let timerInterval = null;
let timerRunning = false;

let groupScores = {
    'Attorney 1': 0,
    'Attorney 2': 0,
    'Attorney 3': 0,
    'Attorney 4': 0
};

io.on('connection', (socket) => {
    socket.emit('updateState', { groupScores, timer, timerRunning });

    socket.on('startTimer', () => {
        if (!timerRunning) {
            timerRunning = true;
            clearInterval(timerInterval);
            
            timerInterval = setInterval(() => {
                if (timer > 0) {
                    timer--;
                    io.emit('timerUpdate', timer);
                } else {
                    timerRunning = false;
                    clearInterval(timerInterval);
                    io.emit('timeUp');
                }
            }, 1000);
        }
    });

    socket.on('submitAnswer', ({ groupName, questionId, answer }) => {
        let correctAnswers = {
            q1: 'RA7277',
            q2: 'RA7610',
            q3: 'RA8371',
            q4: 'CONST',
            q5: 'RA7277',
            q6: 'RA7610'
        };

        let isCorrect = (correctAnswers[questionId] === answer);
        if (isCorrect) {
            if (groupScores[groupName] !== undefined) {
                groupScores[groupName]++;
            }
        }

        socket.emit('answerFeedback', { questionId, isCorrect });
        io.emit('updateState', { groupScores, timer, timerRunning });
    });

    socket.on('resetGame', () => {
        timerRunning = false;
        clearInterval(timerInterval);
        timer = 30;
        groupScores = {
            'Attorney 1': 0,
            'Attorney 2': 0,
            'Attorney 3': 0,
            'Attorney 4': 0
        };
        io.emit('resetState');
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});