# Визуализация скорборда

Экран, который шёл в зале и у игроков во время игры. Здесь собранная версия
с встроенными демо-данными: 16 гарнизонов, четыре сервиса, атаки и статусы
чекера генерируются в браузере.

```sh
python3 -m http.server 8000
```

Затем откройте:

- [http://localhost:8000/index.html?mock=1](http://localhost:8000/index.html?mock=1): табло гарнизонов
- [http://localhost:8000/table.html?mock=1](http://localhost:8000/table.html?mock=1): таблица игры
- [http://localhost:8000/team.html?mock=1](http://localhost:8000/team.html?mock=1): город гарнизона

Добавьте `&kiosk=1`, и страницы начнут листаться сами, как на экране в зале.
