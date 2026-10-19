const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// I-serve ang mga static files (tulad ng index.html, background.jpg, logo.png, my-photo.png) mula sa root folder
app.use(express.static(path.join(__dirname)));

let groupScores = {
    'Attorney 1': 0,
    'Attorney 2': 0,
    'Attorney 3': 0,
    'Attorney 4': 0
};

let timer = 30; // 30 seconds timer o depende sa gusto mo
let timerInterval = null;
let timerRunning = false;

io.on('connection', (socket) => {
    console.log('Isang gumagamit o judge/counsel ay kumonekta.');

    // Ipadala ang kasalukuyang estado ng laro sa bagong pasok na user
    socket.emit('updateState', { groupScores, timer, timerRunning });

    // Pagsisimula ng Timer ng Judge
    socket.on('startTimer', () => {
        if (!timerRunning) {
            timerRunning = true;
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

    // Pag-reset ng Laro
    socket.on('resetGame', () => {
        clearInterval(timerInterval);
        timerRunning = false;
        timer = 30;
        Object.keys(groupScores).forEach(group => {
            groupScores[group] = 0;
        });
        io.emit('resetState');
    });

    // Pagtanggap at pag-check ng sagot ng mga Attorneys (Q1 hanggang Q6)
    socket.on('submitAnswer', ({ groupName, questionId, answer }) => {
        // Mga tamang sagot batay sa iyong 6 na katanungan
        let correctAnswers = {
            q1: 'RA7277',  // Magna Carta for Disabled Persons
            q2: 'RA7610',  // Special Protection Against Child Abuse
            q3: 'RA8371',  // Indigenous Peoples Rights Act (IPRA)
            q4: 'CONST',   // 1987 Philippine Constitution
            q5: 'RA7277',  // Rehabilitation of Disabled Persons
            q6: 'RA7836'   // Philippine Teachers Professionalization Act
        };

        let isCorrect = (correctAnswers[questionId] === answer);
        if (isCorrect) {
            if (groupScores[groupName] !== undefined) {
                groupScores[groupName]++;
            }
        }

        // Ipadala ang feedback kung tama o mali ang sinagot ng partikular na attorney
        socket.emit('answerFeedback', { questionId, isCorrect });

        // I-update ang live scoreboard sa lahat ng screen
        io.emit('updateState', { groupScores, timer, timerRunning });
    });

    socket.on('disconnect', () => {
        console.log('Isang user ay nag-disconnect.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Ang server ay tumatakbo sa http://localhost:${PORT}`);
});