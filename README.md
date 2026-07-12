# 红十 Web MVP

无需登录的网页红十原型。房主创建房间后，把 `/room/{roomId}` 链接发给朋友；朋友输入昵称即可入座。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

也可以先构建再按生产模式运行：

```bash
npm run build
npm start
```

## 部署

Render Web Service 可直接使用：

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment: Node.js

第一版房间状态保存在服务内存里，适合单实例部署。服务器重启或重新部署会丢失正在进行的房间。

## 已实现规则

- 2-10 人，1-6 副牌，每副 54 张含大小王。
- 只有红桃 10 是红十；拿到红桃 10 的玩家为红十方。
- 全部发完，不能平均时前面座位多一张。
- 红桃 3 首出；多副牌多人持有红桃 3 时可抢首出。
- 牌型：单张、对子、顺子、连对、三连、炸弹、王炸。
- 服务端负责洗牌、发牌、判牌、压牌、过牌、接风和结算。
