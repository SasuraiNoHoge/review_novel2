'use strict';
const express = require('express');
const router = express.Router();
const authenticationEnsurer = require('./authentication-ensurer');
const uuid = require('uuid');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
const User = require('../models/user');
const Availability = require('../models/availability');
const Comment = require('../models/comment');


router.get('/new', authenticationEnsurer, (req, res, next) => {
  res.render('new', { user: req.user });
});

router.post('/', authenticationEnsurer, (req, res, next) => {
  const scheduleId = uuid.v4();
  const updatedAt = new Date();
  Schedule.create({
    scheduleId: scheduleId,
    scheduleName: req.body.scheduleName.slice(0, 255) || '（名称未設定）',
    memo: req.body.memo,
    createdBy: req.user.id,
    provider: req.user.provider,
    updatedAt: updatedAt
  }).then((schedule) => {
    const candidateNames = req.body.candidates.trim().split('\n').map((s) => s.trim()).filter((s) => s !== "");
    const candidates = candidateNames.map((c) => {
      return {
        candidateName: c,
        scheduleId: schedule.scheduleId
      };
    });
    Candidate.bulkCreate(candidates).then(() => {
      res.redirect('/schedules/' + schedule.scheduleId);
    });
  });
});

router.get('/:scheduleId', authenticationEnsurer, (req, res, next) => {
  let storedSchedule = null;
  let storedCandidates = null;
  Schedule.findOne({
    include: [
      {
        model: User,
        attributes: ['userId','provider', 'username']
      }],
    where: {
      scheduleId: req.params.scheduleId
    },
    order: [['"updatedAt"', 'DESC']]
  }).then((schedule) => {
    if (schedule) {
      storedSchedule = schedule;
      return Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['"candidateId"', 'ASC']]
      });
    } else {
      const err = new Error('指定された予定は見つかりません');
      err.status = 404;
      next(err);
    }
  }).then((candidates) => {
    // データベースからその予定の全ての出欠を取得する
    storedCandidates = candidates;
    return Availability.findAll({
      include: [
        {
          model: User,
          attributes: ['userId','provider', 'username']
        }
      ],
      where: { scheduleId: storedSchedule.scheduleId },
      order: [[User, '"username"', 'ASC'], ['"candidateId"', 'ASC']]
    });
  }).then((availabilities) => {
    // 出欠 MapMap(キー:ユーザー ID, 値:出欠Map(キー:候補 ID, 値:出欠)) を作成する
    const availabilityMapMap = new Map(); // key: userId, value: Map(key: candidateId, availability)
    availabilities.forEach((a) => {
      const aMapKey = a.user.userId+a.user.provider;
      const map = availabilityMapMap.get(aMapKey) || new Map();
      map.set(a.candidateId, a.availability);
      availabilityMapMap.set(aMapKey, map);
    });

    // 閲覧ユーザーと出欠に紐づくユーザーからユーザー Map (キー:ユーザー ID, 値:ユーザー) を作る
    const userMap = new Map(); // key: userId, value: User
    const reqUserMap = req.user.id+req.user.provider;
    userMap.set(reqUserMap, {
      isSelf: true,
      userId: req.user.id,
      provider: req.user.provider,
      username: req.user.username
    });
    availabilities.forEach((a) => {
      userMap.set(reqUserMap, {
        isSelf: parseInt(req.user.id) === a.user.userId && req.user.provider === a.user.provider, // 閲覧ユーザー自身であるかを含める
        userId: a.user.userId,
        provider: provider,
        username: a.user.username
      });
    });

    // 全ユーザー、全候補で二重ループしてそれぞれの出欠の値がない場合には、「欠席」を設定する
    const users = Array.from(userMap).map((keyValue) => keyValue[1]);
    users.forEach((u) => {
      const userMapKey = u.userId+u.provider;
      storedCandidates.forEach((c) => {
        const map = availabilityMapMap.get(userMapKey) || new Map();
        const a = map.get(c.candidateId) || 0; // デフォルト値は 0 を利用
        map.set(c.candidateId, a);
        availabilityMapMap.set(userMapKey, map);
      });
    });

    // コメント取得
    return Comment.findAll({
      where: { scheduleId: storedSchedule.scheduleId }
    }).then((comments) => {
      const commentMap = new Map();  // key: userId, value: comment
      comments.forEach((comment) => {
        const commentMapKey = comment.userId+comment.provider;
        commentMap.set(commentMapKey, comment.comment);
      });
      res.render('schedule', {
        user: req.user,
        schedule: storedSchedule,
        candidates: storedCandidates,
        users: users,
        availabilityMapMap: availabilityMapMap,
        commentMap: commentMap
      });
    });
  });
});

module.exports = router;
