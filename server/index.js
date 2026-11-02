const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  createGame, addPlayer, removePlayer, startGame,
  takeAction, reactToAction, reactToBlock,
  loseInfluence, exchangeCards, playerView,
} = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();
const playerRoom = new Map();

function broadcast(game) {
  for (const player of game.players) {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) socket.emit('game_state', playerView(game, player.id));
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }, cb) => {
    if (!name?.trim()) return cb({ error: 'Name required' });
    const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    const game = createGame(roomId);
    const result = addPlayer(game, socket.id, name.trim());
    if (result.error) return cb(result);
    rooms.set(roomId, game);
    playerRoom.set(socket.id, roomId);
    socket.join(roomId);
    broadcast(game);
    cb({ ok: true, roomId });
  });

  socket.on('join_room', ({ roomId, name }, cb) => {
    if (!name?.trim()) return cb({ error: 'Name required' });
    const id = roomId?.toUpperCase();
    const game = rooms.get(id);
    if (!game) return cb({ error: 'Room not found' });
    const result = addPlayer(game, socket.id, name.trim());
    if (result.error) return cb(result);
    playerRoom.set(socket.id, id);
    socket.join(id);
    broadcast(game);
    cb({ ok: true });
  });

  socket.on('start_game', (cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    if (game.players[0]?.id !== socket.id) return cb?.({ error: 'Only the host can start' });
    const result = startGame(game);
    if (result.error) return cb?.(result);
    broadcast(game);
    cb?.({ ok: true });
  });

  socket.on('take_action', (action, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = takeAction(game, socket.id, action);
    broadcast(game);
    cb?.(result);
  });

  socket.on('react_to_action', (reaction, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = reactToAction(game, socket.id, reaction);
    broadcast(game);
    cb?.(result);
  });

  socket.on('react_to_block', (reaction, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = reactToBlock(game, socket.id, reaction);
    broadcast(game);
    cb?.(result);
  });

  socket.on('lose_influence', ({ cardIndex }, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = loseInfluence(game, socket.id, cardIndex);
    broadcast(game);
    cb?.(result);
  });

  socket.on('exchange_cards', ({ keptCards }, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = exchangeCards(game, socket.id, keptCards);
    broadcast(game);
    cb?.(result);
  });

  socket.on('disconnect', () => {
    const roomId = playerRoom.get(socket.id);
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (game) {
      if (game.phase === 'lobby') {
        removePlayer(game, socket.id);
        if (game.players.length === 0) rooms.delete(roomId);
        else broadcast(game);
      }
    }
    playerRoom.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Coup server running on port ${PORT}`));
