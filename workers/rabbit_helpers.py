"""RabbitMQ helper utilities for Madd Hatch workers."""
from __future__ import annotations

from typing import Any, Mapping, Tuple

from pika.adapters.blocking_connection import BlockingChannel
from pika.exceptions import ChannelClosedByBroker


def ensure_exchange(channel: BlockingChannel, exchange: str, *, exchange_type: str = "direct",
                     durable: bool = True, auto_delete: bool = False) -> BlockingChannel:
    """Ensure ``exchange`` exists on ``channel`` and return an open channel.

    The RabbitMQ definitions provision exchanges during broker boot. However, when
    workers connect while the broker is still initialising they may attempt to
    redeclare an exchange with flags (for example ``auto_delete``) that differ from
    the already-provisioned definition. RabbitMQ treats this as a precondition
    failure and closes the channel which caused the workers to crash on start-up.

    To avoid that mismatch we first perform a passive declaration which simply
    verifies the exchange exists without modifying its properties. If the exchange
    is missing we create it with the desired attributes. A passive declaration that
    fails closes the channel, so in that case we open a new channel on the existing
    connection before creating the exchange.
    """
    try:
        channel.exchange_declare(exchange=exchange, exchange_type=exchange_type, passive=True)
        return channel
    except ChannelClosedByBroker as exc:
        if exc.reply_code != 404:
            raise
        new_channel = channel.connection.channel()
        new_channel.exchange_declare(
            exchange=exchange,
            exchange_type=exchange_type,
            durable=durable,
            auto_delete=auto_delete,
        )
        return new_channel


def ensure_queue(
    channel: BlockingChannel,
    queue: str,
    *,
    durable: bool = True,
    exclusive: bool = False,
    auto_delete: bool = False,
    arguments: Mapping[str, Any] | None = None,
) -> Tuple[BlockingChannel, Any]:
    """Ensure ``queue`` exists and return the channel plus declare response.

    Similar to :func:`ensure_exchange`, a passive declaration avoids RabbitMQ
    raising ``PRECONDITION_FAILED`` when worker code declares a queue with
    attributes that differ from those already loaded via broker definitions. In
    particular, the ``orders.q`` queue is pre-provisioned with a dead-letter
    exchange which previously triggered connection resets.
    """

    try:
        method = channel.queue_declare(queue=queue, passive=True)
        return channel, method
    except ChannelClosedByBroker as exc:
        if exc.reply_code != 404:
            raise
        new_channel = channel.connection.channel()
        method = new_channel.queue_declare(
            queue=queue,
            durable=durable,
            exclusive=exclusive,
            auto_delete=auto_delete,
            arguments=dict(arguments or {}),
        )
        return new_channel, method
