"""RabbitMQ helper utilities for Madd Hatch workers."""
from __future__ import annotations

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
