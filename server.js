const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Pinapahintulot ang server na basahin ang background.jpg at iba pang static files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let timer = 30; // 30 Seconds Timer
let timerInterval = null;
let timerRunning = false;
let groupScores = { "Group 1": 0, "Group 2": 0, "Group 3": 0, "Group 4": 0 };
let groupAnswers = { "Group 1": {}, "Group 2": {}, "Group 3": {}, "Group 4": {} };

const correctAnswers = {
    q1: "RA7277",
    q2: "RA7610",
    q3: "RA8371",
    q4: "CONST",
    q5: "RA7277",
    q6: "RA7610"
};

io.on('connection', (socket) => {
    socket.emit('updateState', { groupScores, timer, timerRunning });

    socket.on('submitAnswer', ({ groupName, questionId, answer }) => {
        if (timer <= 0) return;
        if (groupAnswers[groupName][questionId] !== undefined) return;

        groupAnswers[groupName][questionId] = answer;
        const isCorrect = answer === correctAnswers[questionId];
        
        let score = 0;
        for (let q in correctAnswers) {
            if (groupAnswers[groupName][q] === correctAnswers[q]) {
                score++;
            }
        }
        groupScores[groupName] = score;

        socket.emit('answerFeedback', { questionId, isCorrect });
        io.emit('updateState', { groupScores, timer, timerRunning });
    });

    socket.on('startTimer', () => {
        if (!timerRunning) {
            timerRunning = true;
            io.emit('timerStarted', { timer, timerRunning });
            
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
        timerInterval = null;
        timer = 30;
        timerRunning = false;
        groupScores = { "Group 1": 0, "Group 2": 0, "Group 3": 0, "Group 4": 0 };
        groupAnswers = { "Group 1": {}, "Group 2": {}, "Group 3": {}, "Group 4": {} };
        io.emit('resetState', { groupScores, timer });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});