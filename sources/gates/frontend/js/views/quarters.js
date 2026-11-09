// Квартира караульного: расчётная книжка, лавка интенданта, знаки отличия и тайник.

import { api } from '../api.js';
import { state, emit, refreshPurse } from '../state.js';
import {
  h, mount, toast, fail, field, stamp, typing, empty, errorBox, pager, confirmBox,
  fmtDate, kop,
} from '../ui.js';
import { sprite, sfx } from '../art.js';

function household(p) {
  const owned = new Set(p.catalog.filter((c) => c.owned).map((c) => c.code));
  const lines = [];
  if (p.balance < 0) lines.push('Лавочник отпускает в долг с неохотой. Жена пересчитывает копейки.');
  else if (p.balance >= 100) lines.push('Отложено на чёрный день. Тёща довольна — впервые.');
  else lines.push('Концы с концами сходятся. Пока.');
  lines.push(owned.has('stove') ? 'В избе тепло: голландка держит жар до утра.' : 'В избе зябко — дров хватает впритык.');
  if (owned.has('samovar')) lines.push('Вечером чай с баранками.');
  if (p.suspicion > 0) lines.push('Соседи шепчутся, откуда у караульного лишние деньги.');
  return lines;
}

export function quartersView(container) {
  const book = h('div.paper.tilt-l');
  const shop = h('div.paper.paper--white');
  const side = h('div.stack');
  const ledgerBox = h('div');
  let ledgerOffset = 0;
  let stashCode = null;   // шифр держим только пока тайник открыт
  let stashItems = null;

  async function loadLedger() {
    mount(ledgerBox, typing());
    try {
      const r = await api.ledger({ offset: ledgerOffset, limit: 12 });
      if (!r.items.length) { mount(ledgerBox, empty('Записей нет.')); return; }
      mount(ledgerBox,
        h('table.ledger.paylines',
          h('tbody', r.items.map((e) => h('tr',
            h('td', h('div', e.memo), h('div.small.muted', fmtDate(e.created_at))),
            h(`td.num${e.amount < 0 ? '.minus' : ''}`, `${e.amount > 0 ? '+' : ''}${e.amount}`))))),
        pager(r, (o) => { ledgerOffset = o; loadLedger(); }));
    } catch (e) {
      mount(ledgerBox, errorBox(e, loadLedger));
    }
  }

  function renderBook(p) {
    mount(book,
      h('div.paper__head', h('h3', 'Расчётная книжка'), h('span.paper__kicker', state.me.callsign)),
      h('div.purse', h('span.purse__label', 'На руках'), h(`span.purse__sum${p.balance < 0 ? '.minus' : ''}`, kop(p.balance))),
      h('div.purse__stats',
        h('div', 'Усердие', h('b', `×${p.streak}`)),
        h('div', 'Лучшее', h('b', `×${p.best_streak}`)),
        h('div', 'Верных', h('b', p.stamps_ok)),
        h('div', 'Замечаний', h('b', p.stamps_miss))),
      h('ul.household', household(p).map((l) => h('li', l))),
      h('details.rates',
        h('summary', 'Расценки'),
        h('ul',
          h('li', `Верный штамп: +${p.rates.stamp_ok}; каждый ${p.rates.streak_every}-й подряд: ещё +${p.rates.streak}`),
          h('li', `Поимка разыскиваемого: +${p.rates.wanted}; приказ дня: +${p.rates.bounty}`),
          h('li', `Замечание: −${p.rates.stamp_miss}`),
          h('li', `Подношение: +${p.rates.bribe_min}…${p.rates.bribe_max}; от разыскиваемого: −${p.rates.bribe_seized}`),
          h('li', `Ревизия с ${p.rates.audit_from}-го подношения за караул: −${p.rates.audit} за каждое`),
          h('li', `Казённое жалованье: +${p.rates.wage} при ${p.rates.wage_min_stamps}+ штампах за караул`),
          h('li', `Квартирные −${p.rates.rent}, дрова −${p.rates.wood}, хлеб −${p.rates.bread} при каждой сдаче караула`))),
      h('h3', { style: { fontSize: '13px', margin: '14px 0 6px' } }, 'Последние записи'),
      ledgerBox);
  }

  function renderShop(p) {
    mount(shop,
      h('div.paper__head', h('h3', 'Лавка интенданта'), h('span.paper__kicker', 'за наличные')),
      h('div.shop', p.catalog.map((item) => h(`div.ware${item.owned ? '.ware--owned' : ''}`,
        h('div.ware__icon', sprite(item.code, { px: 4 })),
        h('div.ware__body',
          h('div.ware__name', item.name),
          h('div.ware__desc', item.description)),
        h('div.ware__buy',
          item.owned
            ? stamp('Куплено', 'ok', 'stamp--sm')
            : h('button.btn.btn--ink.btn--sm', {
              type: 'button',
              disabled: p.balance < item.price,
              title: p.balance < item.price ? `Не хватает ${item.price - p.balance} коп.` : null,
              onclick: () => buy(item),
            }, `${item.price} коп.`))))));
  }

  async function buy(item) {
    if (!(await confirmBox(`Купить «${item.name}» за ${item.price} коп.?`, { ok: 'Купить', danger: false }))) return;
    try {
      state.purse = await api.buy(item.code);
      emit('purse', state.purse);
      sfx.stamp();
      toast(`Куплено: ${item.name}.`, 'ok');
      render();
      ledgerOffset = 0;
      loadLedger();
    } catch (e) { fail(e); }
  }

  function renderStash(p) {
    const box = h('div.paper.stash');
    const head = h('div.paper__head', h('h3', 'Тайник под половицей'), h('span.paper__kicker', p.stash.owned ? `бумаг: ${p.stash.items}` : 'нет'));
    if (!p.stash.owned) {
      mount(box, head, h('div.floor', sprite('stash', { px: 5 })),
        h('p.small.muted', 'Половица прибита намертво. Тайник продаётся в лавке интенданта.'));
      return box;
    }
    if (!p.stash.locked) {
      const code = h('input.input', { inputmode: 'numeric', pattern: '\\d{4,8}', required: true, maxlength: 8, placeholder: '4–8 цифр', autocomplete: 'off' });
      mount(box, head, h('div.floor', sprite('stash', { px: 5 })),
        h('form.stack', {
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await api.stashSetCode(code.value);
              sfx.stamp();
              toast('Шифр задан. Не забудьте его — канцелярия не напомнит.', 'ok');
              await refreshPurse();
              render();
            } catch (err) { fail(err); }
          },
        }, h('p.small', 'Задайте шифр замка. Без него тайник не откроется никому — и вам тоже.'), field('Шифр', code), h('div.row.row--end', h('button.btn.btn--ink', { type: 'submit' }, 'Запереть'))));
      return box;
    }
    if (stashCode === null) {
      const code = h('input.input', { inputmode: 'numeric', required: true, maxlength: 8, placeholder: 'шифр', autocomplete: 'off' });
      mount(box, head, h('div.floor', sprite('stash', { px: 5 })),
        h('form.row', {
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              stashItems = await api.stashOpen(code.value);
              stashCode = code.value;
              sfx.paper();
              render();
            } catch (err) { sfx.denied(); fail(err); }
          },
        }, h('label.field.grow', h('span.field__label', 'Шифр замка'), code), h('button.btn.btn--ink', { type: 'submit' }, 'Отпереть')));
      return box;
    }

    const label = h('input.input', { required: true, maxlength: 64, placeholder: 'например, «Письмо от брата»' });
    const content = h('textarea.input', { required: true, maxlength: 1024, rows: 3 });
    const items = stashItems.length
      ? h('div.notes', stashItems.map((it) => h('div.note',
        h('div.note__meta', `${it.id} · ${fmtDate(it.created_at)}`),
        h('div', h('b', it.label)),
        h('div.note__text', it.content),
        h('div.row.row--end', h('button.btn.btn--ink.btn--sm', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmBox(`Забрать «${it.label}» из тайника насовсем?`, { ok: 'Забрать' }))) return;
            try {
              await api.stashTake(stashCode, it.id);
              stashItems = stashItems.filter((x) => x.id !== it.id);
              await refreshPurse();
              render();
            } catch (err) { fail(err); }
          },
        }, 'Забрать')))))
      : empty('Под половицей пусто.');
    const oldCode = h('input.input', { inputmode: 'numeric', maxlength: 8, placeholder: 'прежний', autocomplete: 'off' });
    const newCode = h('input.input', { inputmode: 'numeric', maxlength: 8, placeholder: 'новый', autocomplete: 'off' });
    mount(box, head,
      items,
      h('form.stack', {
        style: { marginTop: '12px' },
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const it = await api.stashPut(stashCode, label.value.trim(), content.value);
            stashItems = [it, ...stashItems];
            sfx.paper();
            await refreshPurse();
            render();
          } catch (err) { fail(err); }
        },
      }, field('Надпись', label), field('Что спрятать', content), h('div.row.row--end', h('button.btn.btn--ink', { type: 'submit' }, 'Спрятать'))),
      h('details', { style: { marginTop: '12px' } },
        h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'Сменить шифр'),
        h('form.row', {
          style: { marginTop: '8px' },
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await api.stashSetCode(newCode.value, oldCode.value);
              stashCode = newCode.value;
              toast('Шифр сменён.', 'ok');
            } catch (err) { fail(err); }
          },
        }, h('label.field.grow', h('span.field__label', 'Прежний'), oldCode), h('label.field.grow', h('span.field__label', 'Новый'), newCode), h('button.btn.btn--ink.btn--sm', { type: 'submit' }, 'Сменить'))),
      h('div.row.row--end', { style: { marginTop: '12px' } },
        h('button.btn.btn--sm', { type: 'button', onclick: () => { stashCode = null; stashItems = null; render(); } }, 'Задвинуть половицу')));
    return box;
  }

  function renderSide(p) {
    mount(side,
      h('div.paper.paper--note.order',
        h('div.paper__kicker', 'Приказ дня'),
        p.bounty
          ? h('p', `Особое внимание — «${p.bounty.zone_name}». За каждый верный штамп туда: ещё +${p.bounty.bonus} коп.`)
          : h('p', 'Приказа на сегодня нет.')),
      h('div.paper',
        h('div.paper__head', h('h3', 'Знаки отличия')),
        h('div.medals', p.medals.map((m) => h(`div.medal${m.earned ? '' : '.medal--locked'}`,
          h('span.medal__disc', { 'aria-hidden': 'true' }),
          h('div', h('div.medal__name', m.name), h('div.medal__desc', m.earned ? 'Пожалован.' : m.description)))))),
      renderStash(p));
  }

  function render() {
    const p = state.purse;
    if (!p) return;
    renderBook(p);
    renderShop(p);
    renderSide(p);
  }

  mount(container,
    h('div.view-head', h('div', h('h2', 'Квартира'), h('p', 'Жалованье считает канцелярия: верный штамп кормит, ошибка — нет. На скопленное в лавке продаются вещи, облегчающие службу.'))),
    h('div.office.quarters', book, shop, side));
  mount(book, typing());
  refreshPurse().then((p) => {
    if (!p) { mount(book, errorBox(new Error('Расчётная книжка не найдена.'))); return; }
    render();
    loadLedger();
  });
  return {
    onShift: () => refreshPurse().then(() => { render(); ledgerOffset = 0; loadLedger(); }),
  };
}
